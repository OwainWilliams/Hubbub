import { lookToWire, type Look } from '../avatar/look';
import { WORKER_URL } from './config';
import { PeerManager, type LinkStats, type MediaKind } from './peers';
import { MAX_PEERS, type ChatMsg, type PeerInfo, type ServerMsg, type ShareMsg, type StateMsg } from './protocol';
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
  share?(id: string, m: ShareMsg): void;
  linkChanged?(id: string, status: LinkStatus): void;
  /** The server connection dropped. The room treats that as us leaving, so the page rejoins. */
  serverLost?(): void;
}

const MAX_RETRIES = 5;
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

  /** Extra listeners for link changes (voice and screen sharing use these; the game scene uses handlers.linkChanged). */
  readonly linkListeners: Array<(id: string, status: LinkStatus) => void> = [];

  /** Listeners for screen-share announcements from other people. */
  readonly shareListeners: Array<(id: string, m: ShareMsg) => void> = [];

  private readonly retries = new Map<string, number>();
  private readonly retryTimers = new Map<string, number>();
  private seq = 0;
  /** Where we are: '' outdoors, otherwise a building id. Set it with setPlace. */
  place = '';

  private constructor(
    readonly self: PeerInfo,
    readonly code: string,
    private readonly signalling: Signalling,
    private peers: PeerManager,
  ) {}

  static async join(opts: { code: string; name: string; color: string; look: Look }): Promise<Session> {
    if (typeof RTCPeerConnection === 'undefined' || typeof WebSocket === 'undefined') {
      throw new Error('This browser is missing features Hubbub needs. Try a recent Chrome, Edge, Firefox or Safari.');
    }
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
      sig.send({ type: 'hello', name: opts.name, color: opts.color, look: lookToWire(opts.look) });
    });

    // Built in two steps because the peer callbacks need the session object that owns the manager.
    const holder: { session?: Session } = {};
    const peers = new PeerManager(ice, (to, data) => sig.send({ type: 'signal', to, data }), {
      onOpen: (id) => holder.session?.setStatus(id, 'connected'),
      onClosed: (id) => holder.session?.linkLost(id),
      onState: (id, m) => holder.session?.onPeerState(id, m),
      onChat: (id, m: ChatMsg) => holder.session?.handlers.chat?.(id, m.text),
      onShare: (id, m) => holder.session?.shareListeners.forEach((fn) => fn(id, m)),
    });
    const session = new Session({ id: welcome.id, name: opts.name, color: opts.color, look: opts.look }, opts.code, sig, peers);
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
          window.clearTimeout(this.retryTimers.get(m.id));
          this.retries.delete(m.id);
          this.peers.remove(m.id, true);
          for (const fn of this.linkListeners) fn(m.id, 'failed'); // so voice and screen share let go of them
          this.handlers.peerLeft?.(m.id);
        }
        break;
      case 'signal':
        if (!this.roster.has(m.from)) break;
        if (m.data.kind === 'reset') this.onReset(m.from);
        else this.peers.handleSignal(m.from, m.data);
        break;
    }
  }

  /**
   * A connection to someone broke. Both sides drop it and the person with the lower id starts a fresh one, so
   * there is always exactly one offer. Tries a few times with a growing pause, then gives up and says so.
   */
  private linkLost(id: string): void {
    if (!this.roster.has(id)) return;
    const attempt = (this.retries.get(id) ?? 0) + 1;
    this.retries.set(id, attempt);
    if (attempt > MAX_RETRIES) {
      this.setStatus(id, 'failed');
      return;
    }
    this.setStatus(id, 'connecting');
    this.signalling.send({ type: 'signal', to: id, data: { kind: 'reset' } });
    this.scheduleOffer(id, Math.min(1000 * 2 ** (attempt - 1), 15_000));
  }

  /** The other side says their connection to us broke. */
  private onReset(id: string): void {
    this.peers.remove(id, true);
    this.setStatus(id, 'connecting');
    this.scheduleOffer(id, 500);
  }

  private scheduleOffer(id: string, delayMs: number): void {
    window.clearTimeout(this.retryTimers.get(id));
    if (this.self.id > id) return; // the other person is the one who starts it
    this.retryTimers.set(
      id,
      window.setTimeout(() => {
        const entry = this.roster.get(id);
        if (!entry || entry.status === 'connected' || this.peers.has(id)) return;
        void this.peers.connectTo(id).catch(() => this.linkLost(id));
      }, delayMs),
    );
  }

  /** For tests: drop the server connection, as a server restart would. */
  debugDropServer(): void {
    this.signalling.close();
  }

  /** For tests: break the connection to someone as if the network had dropped it. */
  debugBreak(id: string): void {
    this.peers.remove(id);
  }

  private setStatus(id: string, status: LinkStatus): void {
    const entry = this.roster.get(id);
    if (!entry || entry.status === status) return;
    if (status === 'connected') this.retries.delete(id);
    entry.status = status;
    this.handlers.linkChanged?.(id, status);
    for (const fn of this.linkListeners) fn(id, status);
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

  /** Tells one person that we started or stopped sharing. */
  sendShare(id: string, m: ShareMsg): void {
    this.peers.sendTo(id, m);
  }

  /** Voice and video slots, see PeerLink. */
  setOutgoing(id: string, kind: MediaKind, track: MediaStreamTrack | null): Promise<boolean> {
    return this.peers.setOutgoing(id, kind, track);
  }

  setVideoQuality(id: string, bitsPerSecond: number, scaleDownBy: number): Promise<void> {
    return this.peers.setVideoQuality(id, bitsPerSecond, scaleDownBy);
  }

  incoming(id: string, kind: MediaKind): MediaStreamTrack | null {
    return this.peers.incoming(id, kind);
  }

  stats(id: string): Promise<LinkStats | null> {
    return this.peers.stats(id);
  }

  leave(): void {
    this.peers.closeAll();
    this.signalling.close();
  }
}
