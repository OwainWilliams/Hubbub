import type { Session } from '../net/session';
import { gainFor, panFor, shouldHear } from './range';

export interface Where {
  x: number;
  y: number;
  /** '' outdoors, otherwise a building id. */
  place: string;
}

interface Pipe {
  el: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
  /** Whether we are currently sending our voice to them. */
  sending: boolean;
  speakingUntil: number;
}

const SPEAKING_LEVEL = 0.03;
const SPEAKING_HOLD_MS = 350;

/**
 * Proximity voice. Each person has a mic track that is only handed to the people who should hear us (so
 * far-away people cost no bandwidth), and everyone's incoming voice goes through its own volume and pan.
 */
export class Voice {
  private ctx?: AudioContext;
  private micStream?: MediaStream;
  private track?: MediaStreamTrack;
  private micAnalyser?: AnalyserNode;
  private micSpeakingUntil = 0;
  private muted = false;
  private readonly pipes = new Map<string, Pipe>();
  private lastSelf: Where = { x: 0, y: 0, place: '' };
  private lastOthers = new Map<string, Where>();
  private readonly buf = new Uint8Array(256);

  constructor(private readonly session: Session) {
    session.linkListeners.push((id, status) => {
      if (status === 'connected') this.attach(id);
      else this.detach(id);
    });
    for (const [id, p] of session.roster) if (p.status === 'connected') this.attach(id);
  }

  get micOn(): boolean {
    return !!this.track;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Asks for the microphone. Throws an Error with a message that is safe to show. */
  async enable(): Promise<void> {
    if (this.track) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use a microphone here (it needs a secure page).');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') throw new Error('Microphone permission was refused. Allow it in the address bar and try again.');
      if (name === 'NotFoundError') throw new Error('No microphone was found.');
      throw new Error('Could not start the microphone.');
    }
    this.micStream = stream;
    this.track = stream.getAudioTracks()[0];
    this.track.onended = () => this.disable(); // unplugged, or permission taken away
    const ctx = this.context();
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(this.micAnalyser); // not connected to the speakers: no echo of yourself
    this.muted = false;
    this.refresh();
  }

  disable(): void {
    this.track?.stop();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.track = undefined;
    this.micStream = undefined;
    this.micAnalyser = undefined;
    this.refresh();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.track) this.track.enabled = !muted;
    this.refresh();
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Called when a link to someone becomes usable: set up how we play their voice. */
  attach(id: string): void {
    if (this.pipes.has(id)) return;
    const incoming = this.session.incoming(id, 'audio');
    if (!incoming) return;
    const ctx = this.context();
    const stream = new MediaStream([incoming]);

    // Chrome only delivers a remote stream to Web Audio if it is also attached to a media element.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    source.connect(gain).connect(pan).connect(ctx.destination);
    this.pipes.set(id, { el, source, gain, pan, analyser, sending: false, speakingUntil: 0 });
    this.refresh();
  }

  detach(id: string): void {
    const p = this.pipes.get(id);
    if (!p) return;
    p.source.disconnect();
    p.gain.disconnect();
    p.pan.disconnect();
    p.el.srcObject = null;
    this.pipes.delete(id);
  }

  /** Call about ten times a second with where everyone is. */
  update(self: Where, others: Map<string, Where>, now = performance.now()): void {
    this.lastSelf = self;
    this.lastOthers = others;
    this.refresh(now);
  }

  private refresh(now = performance.now()): void {
    const self = this.lastSelf;
    const ctx = this.ctx;
    for (const [id, p] of this.pipes) {
      const other = this.lastOthers.get(id);
      const samePlace = !!other && other.place === self.place;
      const distance = other ? Math.hypot(other.x - self.x, other.y - self.y) : Infinity;
      const indoors = self.place !== '';

      // Playing their voice: volume and side depend on where they stand.
      if (ctx) {
        p.gain.gain.setTargetAtTime(gainFor({ samePlace, indoors, distance }), ctx.currentTime, 0.05);
        p.pan.pan.setTargetAtTime(samePlace && !indoors && other ? panFor(other.x - self.x, distance) : 0, ctx.currentTime, 0.05);
      }

      // Sending ours: only to people who can hear us.
      const send = !!this.track && !this.muted && shouldHear({ samePlace, indoors, distance, wasAudible: p.sending });
      if (send !== p.sending) {
        p.sending = send;
        void this.session.setOutgoing(id, 'audio', send ? this.track! : null);
      }

      p.analyser.getByteTimeDomainData(this.buf);
      if (level(this.buf) > SPEAKING_LEVEL) p.speakingUntil = now + SPEAKING_HOLD_MS;
    }
    if (this.micAnalyser && !this.muted) {
      this.micAnalyser.getByteTimeDomainData(this.buf);
      if (level(this.buf) > SPEAKING_LEVEL) this.micSpeakingUntil = now + SPEAKING_HOLD_MS;
    }
  }

  isSpeaking(id: string | 'self', now = performance.now()): boolean {
    if (id === 'self') return !!this.track && !this.muted && now < this.micSpeakingUntil;
    return now < (this.pipes.get(id)?.speakingUntil ?? 0);
  }

  /** For tests and the connection display: what we send and hear, per person. */
  async debug(): Promise<Record<string, { name: string; sending: boolean; volume: number; audioBytes: number; relayed: boolean }>> {
    const out: Record<string, { name: string; sending: boolean; volume: number; audioBytes: number; relayed: boolean }> = {};
    for (const [id, p] of this.pipes) {
      const stats = await this.session.stats(id);
      out[id] = { name: this.session.roster.get(id)?.name ?? id, sending: p.sending, volume: p.gain.gain.value, audioBytes: stats?.audioBytes ?? 0, relayed: stats?.relayed ?? false };
    }
    return out;
  }

  dispose(): void {
    this.disable();
    for (const id of [...this.pipes.keys()]) this.detach(id);
    void this.ctx?.close();
  }
}

/** Loudness of a block of samples, 0 (silence) to 1. */
function level(samples: Uint8Array): number {
  let sum = 0;
  for (const v of samples) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / samples.length);
}
