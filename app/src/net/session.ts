import { WORKER_URL } from './config';
import { PeerManager } from './peers';
import { MAX_PEERS, type ChatMsg, type PeerInfo, type ServerMsg, type StateMsg } from './protocol';
import { Signalling } from './signalling';

export type LinkStatus = 'connecting' | 'connected' | 'failed';

export interface RosterEntry extends PeerInfo {
  status: LinkStatus;
  /** Where they last said they were: '' outdoors, otherwise a building id. */
  place: string;
}

export interface SessionHandlers {
  peerJoined?(p: PeerInfo): void;
  peerLeft?(id: string): void;
  /** `previousPlace` is where that person was before this update. */
  peerState?(id: string, m: StateMsg, previousPlace: string): void;
  chat?(id: string, text: string): void;
  linkChanged?(id: string, status: LinkStatus): void;
  /** The server connection dropped. Existing peer links keep working; new people cannot join. */
  serverLost?(): void;
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const JOIN_TIMEOUT_MS = 8000;

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${WORKER_URL}/ice`);
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    return body.iceServers?.length ? body.iceServers : FALLBACK_ICE;
  } catch {
    return FALLBACK_ICE;
  }
}

export function roomUrl(code: string): string {
  return `${WORKER_URL.replace(/^http/, 'ws')}/room/${encodeURIComponent(code)}`;
}

export class Session {
  readonly handlers: SessionHandlers = {};
  readonly roster = new Map<string, RosterEntry>();

  private seq = 0;
  /** Where we are: '' outdoors, otherwise a building id. Set it with setPlace. */
  place = '';

  private constructor(
    readonly self: PeerInfo,
    readonly code: string,
    private readonly signalling: Signalling,
    private peers: PeerManager,
  ) {}

  static async join(opts: { code: string; name: string; color: string }): Promise<Session> {
    const ice = await fetchIceServers();
    const sig = new Signalling(roomUrl(opts.code));
    await sig.open();

    const welcome = await new Promise<Extract<ServerMsg, { type: 'welcome' }>>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The server did not answer in time.')), JOIN_TIMEOUT_MS);
      sig.onclose = (code) => {
        window.clearTimeout(timer);
        reject(new Error(code === 4001 ? `This room is full (${MAX_PEERS} people maximum).` : 'The server closed the connection.'));
      };
      sig.onmessage = (m) => {
        if (m.type === 'welcome') {
          window.clearTimeout(timer);
          resolve(m);
        }
      };
      sig.send({ type: 'hello', name: opts.name, color: opts.color });
    });

    // Built in two steps because the peer callbacks need the session object that owns the manager.
    const holder: { session?: Session } = {};
    const peers = new PeerManager(ice, (to, data) => sig.send({ type: 'signal', to, data }), {
      onOpen: (id) => holder.session?.setStatus(id, 'connected'),
      onClosed: (id) => holder.session?.setStatus(id, 'failed'),
      onState: (id, m) => holder.session?.onPeerState(id, m),
      onChat: (id, m: ChatMsg) => holder.session?.handlers.chat?.(id, m.text),
    });
    const session = new Session({ id: welcome.id, name: opts.name, color: opts.color }, opts.code, sig, peers);
    holder.session = session;

    sig.onmessage = (m) => session.onServer(m);
    sig.onclose = () => session.handlers.serverLost?.();

    // We are the newcomer: start a connection to everyone already here.
    for (const p of welcome.peers) {
      session.roster.set(p.id, { ...p, status: 'connecting', place: '' });
      void peers.connectTo(p.id).catch((err) => {
        console.warn('connect failed', p.id, err);
        session.setStatus(p.id, 'failed');
      });
    }
    return session;
  }

  private onServer(m: ServerMsg): void {
    switch (m.type) {
      case 'peer-joined':
        // The newcomer will send us an offer, so we only record them here.
        this.roster.set(m.peer.id, { ...m.peer, status: 'connecting', place: '' });
        this.handlers.peerJoined?.(m.peer);
        break;
      case 'peer-left':
        if (this.roster.delete(m.id)) {
          this.peers.remove(m.id);
          this.handlers.peerLeft?.(m.id);
        }
        break;
      case 'signal':
        if (this.roster.has(m.from)) this.peers.handleSignal(m.from, m.data);
        break;
    }
  }

  private setStatus(id: string, status: LinkStatus): void {
    const entry = this.roster.get(id);
    if (!entry || entry.status === status) return;
    entry.status = status;
    this.handlers.linkChanged?.(id, status);
  }

  private onPeerState(id: string, m: StateMsg): void {
    const entry = this.roster.get(id);
    if (!entry) return;
    const place = m.r ?? '';
    const before = entry.place;
    entry.place = place;
    this.handlers.peerState?.(id, m, before);
  }

  sendState(x: number, y: number): void {
    const m: StateMsg = { t: 'p', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, s: ++this.seq };
    if (this.place) m.r = this.place;
    this.peers.broadcastState(m);
  }

  /** Chat only goes to people in the same place as us, so what is said inside a building stays inside. */
  sendChat(text: string): void {
    this.peers.broadcastChat({ t: 'c', text }, (id) => this.roster.get(id)?.place === this.place);
  }

  leave(): void {
    this.peers.closeAll();
    this.signalling.close();
  }
}
