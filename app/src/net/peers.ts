import { parseChatMsg, parseStateMsg, type ChatMsg, type SignalData, type StateMsg } from './protocol';

export interface PeerEvents {
  onOpen(id: string): void;
  onClosed(id: string): void;
  onState(id: string, m: StateMsg): void;
  onChat(id: string, m: ChatMsg): void;
}

/**
 * One RTCPeerConnection to one other person, with two pre-negotiated data channels:
 *   0 "state": unordered, no retransmits (positions: a late packet is useless)
 *   1 "chat":  ordered and reliable
 * Both sides create the same channels with fixed ids, so no extra channel negotiation is needed.
 */
class PeerLink {
  readonly pc: RTCPeerConnection;
  private readonly state: RTCDataChannel;
  private readonly chat: RTCDataChannel;
  private chain: Promise<void> = Promise.resolve();
  private remoteSet = false;
  private pending: RTCIceCandidateInit[] = [];
  private closed = false;

  constructor(
    private readonly id: string,
    iceServers: RTCIceServer[],
    private readonly sendSignal: (data: SignalData) => void,
    private readonly events: PeerEvents,
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.state = this.pc.createDataChannel('state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.chat = this.pc.createDataChannel('chat', { negotiated: true, id: 1 });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ kind: 'ice', candidate: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.close();
    };
    this.state.onopen = () => events.onOpen(id);
    this.state.onmessage = (e) => {
      const m = parseStateMsg(e.data);
      if (m) events.onState(id, m);
    };
    this.chat.onmessage = (e) => {
      const m = parseChatMsg(e.data);
      if (m) events.onChat(id, m);
    };
  }

  /** Called by the person who joined: they make the offer, so there is never a clash of two offers. */
  async makeOffer(): Promise<void> {
    await this.pc.setLocalDescription();
    this.sendSignal({ kind: 'offer', sdp: this.pc.localDescription!.sdp });
  }

  /** Setup messages are applied strictly in arrival order. */
  handle(data: SignalData): void {
    this.chain = this.chain.then(() => this.apply(data)).catch((err) => console.warn('signal error', this.id, err));
  }

  private async apply(data: SignalData): Promise<void> {
    if (this.closed) return;
    if (data.kind === 'ice') {
      if (this.remoteSet) await this.pc.addIceCandidate(data.candidate);
      else this.pending.push(data.candidate);
      return;
    }
    await this.pc.setRemoteDescription({ type: data.kind, sdp: data.sdp });
    this.remoteSet = true;
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c);
    if (data.kind === 'offer') {
      await this.pc.setLocalDescription();
      this.sendSignal({ kind: 'answer', sdp: this.pc.localDescription!.sdp });
    }
  }

  sendState(m: StateMsg): void {
    if (this.state.readyState === 'open') this.state.send(JSON.stringify(m));
  }

  sendChat(m: ChatMsg): void {
    if (this.chat.readyState === 'open') this.chat.send(JSON.stringify(m));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pc.close();
    this.events.onClosed(this.id);
  }
}

/** Full mesh of PeerLinks, keyed by the other person's id. */
export class PeerManager {
  private readonly links = new Map<string, PeerLink>();

  constructor(
    private readonly iceServers: RTCIceServer[],
    private readonly sendSignal: (to: string, data: SignalData) => void,
    private readonly events: PeerEvents,
  ) {}

  private create(id: string): PeerLink {
    const link = new PeerLink(id, this.iceServers, (d) => this.sendSignal(id, d), {
      ...this.events,
      onClosed: (peerId) => {
        if (this.links.get(peerId) === link) this.links.delete(peerId);
        this.events.onClosed(peerId);
      },
    });
    this.links.set(id, link);
    return link;
  }

  /** We joined after this person, so we start the connection. */
  async connectTo(id: string): Promise<void> {
    if (this.links.has(id)) return;
    await this.create(id).makeOffer();
  }

  handleSignal(from: string, data: SignalData): void {
    let link = this.links.get(from);
    if (!link) {
      if (data.kind !== 'offer') return; // stale answer or candidate for a link we no longer have
      link = this.create(from);
    }
    link.handle(data);
  }

  remove(id: string): void {
    this.links.get(id)?.close();
  }

  broadcastState(m: StateMsg): void {
    for (const l of this.links.values()) l.sendState(m);
  }

  broadcastChat(m: ChatMsg): void {
    for (const l of this.links.values()) l.sendChat(m);
  }

  closeAll(): void {
    for (const l of [...this.links.values()]) l.close();
  }
}
