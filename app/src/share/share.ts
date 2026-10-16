import type { Session } from '../net/session';
import type { ShareMsg } from '../net/protocol';
import type { Where } from '../voice/voice';
import { MAX_VIEWERS, pickViewers, planVideo } from './plan';

type DisplayMediaFn = (options: MediaStreamConstraints) => Promise<MediaStream>;

export interface Watching {
  id: string;
  name: string;
  stream: MediaStream;
}

/**
 * Live screen sharing inside a building. The sharer captures their screen with the browser's own picker and
 * hands that live video to the people in the same room, one connection each. Nothing is recorded or uploaded.
 */
export class ScreenShare {
  /** Called when what we are watching changes, or when we start or stop sharing. */
  onChange: () => void = () => {};
  /** Called with a short message for the chat log. */
  onNotice: (text: string) => void = () => {};

  private stream?: MediaStream;
  private track?: MediaStreamTrack;
  /** People currently receiving our video. */
  private readonly viewers = new Set<string>();
  /** What we last told each person: 0 = nothing, 1 = watching, 2 = full. */
  private readonly told = new Map<string, 1 | 2>();
  /** Other people who say they are sharing, oldest first. */
  private readonly sharers = new Map<string, { full: boolean }>();
  private current: Watching | null = null;
  private lastSelf: Where = { x: 0, y: 0, place: '' };
  private lastOthers = new Map<string, Where>();

  constructor(private readonly session: Session) {
    session.shareListeners.push((id, m) => this.handleShare(id, m));
    session.linkListeners.push((id, status) => {
      if (status !== 'connected') {
        this.sharers.delete(id);
        this.viewers.delete(id);
        this.told.delete(id);
        this.recompute();
      }
    });
  }

  get sharing(): boolean {
    return !!this.track;
  }

  get watching(): Watching | null {
    return this.current;
  }

  /** Who in our room is sharing, if anyone else is. */
  private otherSharerHere(): string | null {
    for (const id of this.sharers.keys()) if (this.here(id)) return id;
    return null;
  }

  private here(id: string): boolean {
    return this.lastSelf.place !== '' && this.session.roster.get(id)?.place === this.lastSelf.place;
  }

  /** Starts sharing. Throws an Error with a message that is safe to show. */
  async start(): Promise<void> {
    if (this.track) return;
    if (this.lastSelf.place === '') throw new Error('Walk into a building to share your screen.');
    const other = this.otherSharerHere();
    if (other) throw new Error(`${this.session.roster.get(other)?.name ?? 'Someone'} is already sharing in this room.`);

    const override = (window as unknown as { __hubbubDisplayMedia?: DisplayMediaFn }).__hubbubDisplayMedia; // test seam
    const gdm: DisplayMediaFn | undefined = override ?? navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
    if (!gdm) throw new Error('This browser cannot share a screen. Use a desktop browser.');

    let stream: MediaStream;
    try {
      stream = await gdm({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') throw new Error('Screen sharing was cancelled.');
      throw new Error('Could not start screen sharing.');
    }
    const track = stream.getVideoTracks()[0];
    try {
      track.contentHint = 'text'; // favour sharp text over smooth motion
    } catch {
      // Not supported everywhere; sharing works without it.
    }
    this.stream = stream;
    this.track = track;
    track.onended = () => this.stop(); // the browser's own "Stop sharing" bar
    this.onChange();
    this.refreshViewers();
  }

  stop(): void {
    if (!this.track) return;
    this.track.onended = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.track = undefined;
    this.stream = undefined;
    for (const id of this.viewers) void this.session.setOutgoing(id, 'video', null);
    for (const id of this.told.keys()) this.session.sendShare(id, { t: 's', on: false });
    this.viewers.clear();
    this.told.clear();
    this.onChange();
  }

  /** Call about ten times a second with where everyone is. */
  update(self: Where, others: Map<string, Where>): void {
    this.lastSelf = self;
    this.lastOthers = others;
    if (this.track && self.place === '') this.stop(); // walked out of the building
    this.refreshViewers();
    this.recompute();
  }

  private refreshViewers(): void {
    const track = this.track;
    if (!track) return;
    const eligible = [...this.lastOthers.keys()].filter((id) => this.here(id) && this.session.roster.get(id)?.status === 'connected');
    const { watching, full } = pickViewers(eligible, MAX_VIEWERS, this.viewers);
    const plan = planVideo(watching.length);

    for (const id of [...this.viewers]) {
      if (!watching.includes(id)) {
        this.viewers.delete(id);
        void this.session.setOutgoing(id, 'video', null);
        if (!eligible.includes(id)) this.told.delete(id);
      }
    }
    for (const id of watching) {
      if (!this.viewers.has(id)) {
        this.viewers.add(id);
        void this.session.setOutgoing(id, 'video', track);
      }
      void this.session.setVideoQuality(id, plan.bitrate, plan.scaleDownBy);
      if (this.told.get(id) !== 1) {
        this.told.set(id, 1);
        this.session.sendShare(id, { t: 's', on: true });
      }
    }
    for (const id of full) {
      if (this.told.get(id) !== 2) {
        this.told.set(id, 2);
        this.session.sendShare(id, { t: 's', on: true, full: true });
      }
    }
    // Anyone we told who has left the room no longer needs to hear from us.
    for (const id of [...this.told.keys()]) if (!eligible.includes(id)) this.told.delete(id);
  }

  private handleShare(id: string, m: ShareMsg): void {
    if (!m.on) {
      this.sharers.delete(id);
    } else {
      this.sharers.delete(id);
      this.sharers.set(id, { full: !!m.full });
      // Two people starting at once: the lower id keeps the screen.
      if (this.track && id < this.session.self.id) {
        this.stop();
        this.onNotice(`${this.session.roster.get(id)?.name ?? 'Someone'} started sharing, so yours stopped.`);
      }
    }
    this.recompute();
  }

  private recompute(): void {
    let next: Watching | null = null;
    for (const [id, info] of this.sharers) {
      if (info.full || !this.here(id)) continue;
      const track = this.session.incoming(id, 'video');
      if (!track) continue;
      // Reuse the stream if it is the same person so the picture does not flicker.
      next = this.current?.id === id ? this.current : { id, name: this.session.roster.get(id)?.name ?? 'Someone', stream: new MediaStream([track]) };
    }
    const full = [...this.sharers].some(([id, info]) => info.full && this.here(id));
    if (full && !next && !this.fullNotified) {
      this.fullNotified = true;
      this.onNotice(`The screen is full (${MAX_VIEWERS} people can watch at once).`);
    }
    if (!full) this.fullNotified = false;
    if (next?.id !== this.current?.id) {
      const first = !this.current && next;
      this.current = next;
      if (first && next) this.onNotice(`${next.name} is sharing their screen. Press Watch to see it.`);
      this.onChange();
    }
  }

  private fullNotified = false;

  dispose(): void {
    this.stop();
  }
}
