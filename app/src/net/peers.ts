import { RateLimiter } from './rateLimit';
import { parseReliableMsg, parseStateMsg, type ChatMsg, type ShareMsg, type SignalData, type StateMsg } from './protocol';

export interface PeerEvents {
  onOpen(id: string): void;
  onClosed(id: string): void;
  onState(id: string, m: StateMsg): void;
  onChat(id: string, m: ChatMsg): void;
  onShare(id: string, m: ShareMsg): void;
}

export type MediaKind = 'audio' | 'video';

/** What has arrived from one person, read from WebRTC stats. Used by tests and the connection display. */
export interface LinkStats {
  audioBytes: number;
  videoBytes: number;
  videoFrames: number;
  /** True when the browser is relaying this link through a TURN server rather than connecting directly. */
  relayed: boolean;
}

/**
 * One RTCPeerConnection to one other person, with two pre-negotiated data channels:
 *   0 "state": unordered, no retransmits (positions: a late packet is useless)
 *   1 "chat":  ordered and reliable
 * Both sides create the same channels with fixed ids, so no extra channel negotiation is needed.
 *
 * Voice and screen sharing use one audio and one video transceiver, created in the first offer. Turning the
 * mic or a screen share on or off just swaps the track in that slot (replaceTrack), so nothing is renegotiated.
 */
const MAX_CHANNEL_MESSAGE = 4096; // characters; real messages are far smaller
const DISCONNECT_GRACE_MS = 8000;

class PeerLink {
  readonly pc: RTCPeerConnection;
  private readonly state: RTCDataChannel;
  private readonly chat: RTCDataChannel;
  private chain: Promise<void> = Promise.resolve();
  private remoteSet = false;
  private pending: RTCIceCandidateInit[] = [];
  private closed = false;
  private disconnectTimer: number | undefined;
  // Allowances per person: about 15 position updates a second is normal, so 40 is generous; chat is a few lines at most.
  private readonly stateLimit = new RateLimiter(60, 40);
  private readonly chatLimit = new RateLimiter(10, 3);

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
      const state = this.pc.connectionState;
      window.clearTimeout(this.disconnectTimer);
      if (state === 'failed') this.close();
      // "disconnected" often heals by itself (Wi-Fi blip), so wait a few seconds before giving up.
      else if (state === 'disconnected') this.disconnectTimer = window.setTimeout(() => this.close(), DISCONNECT_GRACE_MS);
    };
    this.state.onopen = () => events.onOpen(id);
    this.state.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_CHANNEL_MESSAGE || !this.stateLimit.allow()) return;
      const m = parseStateMsg(e.data);
      if (m) events.onState(id, m);
    };
    this.chat.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_CHANNEL_MESSAGE) return;
      const m = parseReliableMsg(e.data);
      if (!m) return;
      if (m.t === 'c' && !this.chatLimit.allow()) return;
      if (m.t === 's') events.onShare(id, m);
      else events.onChat(id, m);
    };
  }

  /** Called by the person who joined: they make the offer, so there is never a clash of two offers. */
  async makeOffer(): Promise<void> {
    this.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.pc.addTransceiver('video', { direction: 'sendrecv' });
    await this.pc.setLocalDescription();
    this.sendSignal({ kind: 'offer', sdp: this.pc.localDescription!.sdp });
  }

  /** Setup messages are applied strictly in arrival order. */
  handle(data: SignalData): void {
    this.chain = this.chain.then(() => this.apply(data)).catch((err) => console.warn('signal error', this.id, err));
  }

  private async apply(data: SignalData): Promise<void> {
    if (this.closed || data.kind === 'reset') return;
    if (data.kind === 'ice') {
      if (this.remoteSet) await this.pc.addIceCandidate(data.candidate);
      else this.pending.push(data.candidate);
      return;
    }
    await this.pc.setRemoteDescription({ type: data.kind, sdp: data.sdp });
    this.remoteSet = true;
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c);
    if (data.kind === 'offer') {
      // The offer brought an audio and a video slot with it. Use them in both directions.
      for (const t of this.pc.getTransceivers()) if (t.direction !== 'sendrecv') t.direction = 'sendrecv';
      await this.pc.setLocalDescription();
      this.sendSignal({ kind: 'answer', sdp: this.pc.localDescription!.sdp });
    }
  }

  private transceiver(kind: MediaKind): RTCRtpTransceiver | undefined {
    return this.pc.getTransceivers().find((t) => t.receiver.track.kind === kind);
  }

  /** Puts a track in our sending slot, or empties it with null. Resolves false if the slot does not exist yet. */
  async setOutgoing(kind: MediaKind, track: MediaStreamTrack | null): Promise<boolean> {
    const t = this.transceiver(kind);
    if (!t || this.closed) return false;
    await t.sender.replaceTrack(track);
    return true;
  }

  /** Limits how much bandwidth this link may use for video, and how large the picture is. Skips no-op changes. */
  async setVideoQuality(bitsPerSecond: number, scaleDownBy: number): Promise<void> {
    const sender = this.transceiver('video')?.sender;
    if (!sender || !sender.track) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const e = params.encodings[0];
    if (e.maxBitrate === bitsPerSecond && e.scaleResolutionDownBy === scaleDownBy) return;
    e.maxBitrate = bitsPerSecond;
    e.scaleResolutionDownBy = scaleDownBy;
    await sender.setParameters(params);
  }

  /** The track their audio or video arrives on. It stays silent or black until they send something. */
  incoming(kind: MediaKind): MediaStreamTrack | null {
    return this.transceiver(kind)?.receiver.track ?? null;
  }

  async stats(): Promise<LinkStats> {
    const out: LinkStats = { audioBytes: 0, videoBytes: 0, videoFrames: 0, relayed: false };
    const report = await this.pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((r) => byId.set(r.id as string, r as Record<string, unknown>));
    report.forEach((r) => {
      const s = r as Record<string, unknown>;
      if (s.type === 'inbound-rtp' && s.kind === 'audio') out.audioBytes += Number(s.bytesReceived ?? 0);
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        out.videoBytes += Number(s.bytesReceived ?? 0);
        out.videoFrames += Number(s.framesDecoded ?? 0);
      }
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        const local = byId.get(s.localCandidateId as string);
        if (local?.candidateType === 'relay') out.relayed = true;
      }
    });
    return out;
  }

  sendState(m: StateMsg): void {
    if (this.state.readyState === 'open') this.state.send(JSON.stringify(m));
  }

  sendChat(m: ChatMsg | ShareMsg): void {
    if (this.chat.readyState === 'open') this.chat.send(JSON.stringify(m));
  }

  /** `quietly` closes without reporting a failure (used when the other side asked us to reset). */
  close(quietly = false): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.disconnectTimer);
    this.pc.close();
    if (!quietly) this.events.onClosed(this.id);
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
    if (data.kind === 'reset') return; // the session deals with these
    let link = this.links.get(from);
    if (!link) {
      if (data.kind !== 'offer') return; // stale answer or candidate for a link we no longer have
      link = this.create(from);
    }
    link.handle(data);
  }

  remove(id: string, quietly = false): void {
    const link = this.links.get(id);
    if (!link) return;
    link.close(quietly);
    this.links.delete(id);
  }

  has(id: string): boolean {
    return this.links.has(id);
  }

  setOutgoing(id: string, kind: MediaKind, track: MediaStreamTrack | null): Promise<boolean> {
    return this.links.get(id)?.setOutgoing(kind, track) ?? Promise.resolve(false);
  }

  setVideoQuality(id: string, bitsPerSecond: number, scaleDownBy: number): Promise<void> {
    return this.links.get(id)?.setVideoQuality(bitsPerSecond, scaleDownBy) ?? Promise.resolve();
  }

  incoming(id: string, kind: MediaKind): MediaStreamTrack | null {
    return this.links.get(id)?.incoming(kind) ?? null;
  }

  async stats(id: string): Promise<LinkStats | null> {
    return (await this.links.get(id)?.stats()) ?? null;
  }

  broadcastState(m: StateMsg): void {
    for (const l of this.links.values()) l.sendState(m);
  }

  /** Sends one reliable message to one person. */
  sendTo(id: string, m: ChatMsg | ShareMsg): void {
    this.links.get(id)?.sendChat(m);
  }

  /** Sends chat to everyone, or only to people `include` accepts (used to keep building chat private). */
  broadcastChat(m: ChatMsg, include: (id: string) => boolean = () => true): void {
    for (const [id, l] of this.links) if (include(id)) l.sendChat(m);
  }

  closeAll(): void {
    for (const l of [...this.links.values()]) l.close();
  }
}
