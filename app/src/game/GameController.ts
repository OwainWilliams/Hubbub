import { lookColor, type Look } from '../avatar/look';
import type { Session } from '../net/session';
import { ScreenShare } from '../share/share';
import type { Hud } from '../ui/hud';
import { Voice, type Where } from '../voice/voice';
import { TILE, checksumChunk, type Building } from '../world/generate';
import { I, generateInterior, interiorBlocked, interiorTile, type Interior } from '../world/interior';
import { hashString } from '../world/rng';
import { World } from '../world/world';
import { Input } from './input';
import { COLLIDE_RADIUS, smoothToward, stepPosition } from './movement';
import { ME, type Renderer, type RendererHost } from './renderer';

const SEND_INTERVAL_MS = 66; // about 15 updates per second
const VOICE_TICK_MS = 100;
const MAX_FRAME_MS = 50; // a long stall must not turn into one huge step through a wall

interface Remote {
  name: string;
  /** Where they are right now (glides towards tx, ty). */
  x: number;
  y: number;
  tx: number;
  ty: number;
  seq: number;
  seen: boolean;
  /** '' outdoors, otherwise a building id. */
  place: string;
}

/**
 * The game itself: where everyone is, walking and collision, going in and out of buildings, chat, voice and
 * screen sharing. It draws nothing; it tells a Renderer (2D or 3D) what to show.
 */
export class GameController implements RendererHost {
  private world!: World;
  private x = 0;
  private y = 0;
  private readonly remotes = new Map<string, Remote>();
  private readonly input = new Input();
  private voice!: Voice;
  private share!: ScreenShare;

  private lastSent = 0;
  private sentX = NaN;
  private sentY = NaN;
  private lastVoiceTick = 0;
  private walkTarget: { x: number; y: number } | null = null;
  private walkStuckMs = 0;
  private facing = { x: 0, y: 1 };

  private interior?: Interior;
  private chunkX = NaN;
  private chunkY = NaN;
  /** Where to stand when we walk back out of a building. */
  private exitPoint = { x: 0, y: 0 };

  constructor(
    private readonly session: Session,
    private readonly hud: Hud,
    private readonly renderer: Renderer,
  ) {}

  async start(): Promise<void> {
    this.world = new World(hashString(this.session.code));
    await this.renderer.start(this);

    const spawn = this.world.spawnPoint();
    this.x = spawn.x;
    this.y = spawn.y;
    this.renderer.addAvatar(ME, this.session.self.name, this.session.self.look);
    this.renderer.placeAvatar(ME, this.x, this.y);
    for (const p of this.session.roster.values()) this.addRemote(p.id, p.name, p.look);

    this.voice = new Voice(this.session);
    this.share = new ScreenShare(this.session);
    this.share.onChange = () => this.syncShare();
    this.share.onNotice = (text) => this.hud.system(text);

    this.renderer.showOutdoors(this.world, this.x, this.y);
    this.renderer.snapCamera(this.x, this.y);
    this.wireSession();
    this.wireHud();
    this.refreshRoster();
    this.updatePlaceLabel();
    this.hud.setHint(
      this.renderer.kind === '3d'
        ? 'Move with WASD or the arrow keys, or click where to walk. Drag to turn the camera, scroll to zoom, Q and E to rotate. Esc leaves the chat box.'
        : 'Move with WASD or the arrow keys, or click or tap where to walk. Esc leaves the chat box.',
    );
    this.installTestHooks();
  }

  // ---- places -------------------------------------------------------------------------------------------

  private get place(): string {
    return this.session.place;
  }

  private enter(b: Building): void {
    this.interior = generateInterior(this.world.seed, b);
    this.exitPoint = { x: (b.doorX + 1) * TILE, y: (b.doorY + 1.5) * TILE };
    this.session.place = b.id;
    this.chunkX = NaN;
    // A little scatter so people who walk in together do not stack on one spot.
    this.x = this.interior.spawn.x + (Math.random() - 0.5) * 24;
    this.y = this.interior.spawn.y - Math.random() * 14;
    this.renderer.showInterior(this.interior);
    this.afterPlaceChange();
    this.syncShare();
  }

  private exit(): void {
    this.interior = undefined;
    this.session.place = '';
    this.x = this.exitPoint.x;
    this.y = this.exitPoint.y;
    this.renderer.showOutdoors(this.world, this.x, this.y);
    this.afterPlaceChange();
    this.syncShare();
  }

  private afterPlaceChange(): void {
    this.renderer.placeAvatar(ME, this.x, this.y);
    this.renderer.snapCamera(this.x, this.y);
    this.sentX = NaN; // forces an update to go out this frame
    this.session.sendState(this.x, this.y);
    for (const [id, r] of this.remotes) this.applyVisibility(id, r);
    this.refreshRoster();
    this.updatePlaceLabel();
  }

  private applyVisibility(id: string, r: Remote): void {
    this.renderer.setAvatarVisible(id, r.seen && r.place === this.place);
  }

  private placeName(place: string): string {
    return this.world.buildingById(place)?.name ?? 'a building';
  }

  private updatePlaceLabel(): void {
    this.hud.setPlace(this.interior ? `Inside ${this.interior.name}` : `Outside · square ${Number.isNaN(this.chunkX) ? 0 : this.chunkX}, ${Number.isNaN(this.chunkY) ? 0 : this.chunkY}`);
  }

  // ---- network and HUD ----------------------------------------------------------------------------------

  private addRemote(id: string, name: string, look: Look): void {
    if (this.remotes.has(id)) return;
    this.renderer.addAvatar(id, name, look);
    this.renderer.setAvatarVisible(id, false); // hidden until their first position arrives
    this.remotes.set(id, { name, x: 0, y: 0, tx: 0, ty: 0, seq: 0, seen: false, place: '' });
  }

  private wireSession(): void {
    const h = this.session.handlers;
    h.peerJoined = (p) => {
      this.addRemote(p.id, p.name, p.look);
      this.hud.system(`${p.name} arrived.`);
      this.refreshRoster();
    };
    h.peerLeft = (id) => {
      const r = this.remotes.get(id);
      this.renderer.removeAvatar(id);
      this.remotes.delete(id);
      if (r) this.hud.system(`${r.name} left.`);
      this.refreshRoster();
    };
    h.peerState = (id, m, previousPlace) => {
      const r = this.remotes.get(id);
      if (!r || m.s <= r.seq) return; // drop late or duplicate packets
      r.seq = m.s;
      r.tx = m.x;
      r.ty = m.y;
      const place = m.r ?? '';
      const changedPlace = place !== r.place || place !== previousPlace;
      r.place = place;
      if (!r.seen || changedPlace) {
        // Outdoor and indoor positions use different coordinates, so snap instead of gliding between them.
        r.seen = true;
        r.x = m.x;
        r.y = m.y;
        this.renderer.placeAvatar(id, m.x, m.y);
      }
      if (changedPlace && previousPlace !== place) {
        this.announceMove(r, previousPlace, place);
        this.refreshRoster();
      }
      this.applyVisibility(id, r);
    };
    h.chat = (id, text) => {
      const r = this.remotes.get(id);
      if (!r) return;
      this.renderer.say(id, text);
      this.hud.chat(r.name, text, false);
    };
    h.linkChanged = (_id, status) => {
      this.refreshRoster();
      // Tell a newly connected peer where we are right away instead of waiting for us to move.
      if (status === 'connected') this.session.sendState(this.x, this.y);
    };
    h.serverLost = () => {
      // The room counts a dropped server connection as us leaving, so everyone else closes their links to us.
      // The way back is to join again, so do that automatically after a short random pause (so a whole room
      // does not reconnect in the same instant after a server restart).
      try {
        sessionStorage.setItem('hubbub.rejoin', '1');
      } catch {
        // Without storage the person can still press the button.
      }
      this.hud.banner('Lost the connection to the server. Rejoining…', { label: 'Rejoin now', run: () => location.reload() });
      window.setTimeout(() => location.reload(), 1000 + Math.random() * 3000);
    };
  }

  private announceMove(r: Remote, from: string, to: string): void {
    const mine = this.place;
    if (to && mine === to) this.hud.system(`${r.name} came in.`);
    else if (from && mine === from) this.hud.system(`${r.name} left the room.`);
    else if (!mine && to) this.hud.system(`${r.name} went into ${this.placeName(to)}.`);
    else if (!mine && from) this.hud.system(`${r.name} came out of ${this.placeName(from)}.`);
  }

  private wireHud(): void {
    this.hud.onSend = (text) => {
      this.session.sendChat(text);
      this.renderer.say(ME, text);
      this.hud.chat(this.session.self.name, text, true);
    };
    this.hud.onMic = () => void this.toggleMic();
    this.hud.onShare = () => void this.toggleShare();
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'm' || e.key === 'M') && document.activeElement?.tagName !== 'INPUT' && this.voice.micOn) void this.toggleMic();
    });
    this.hud.onFocusChange = (focused) => {
      if (focused) this.input.reset(); // a held key must not keep walking while typing
    };
  }

  private async toggleShare(): Promise<void> {
    if (this.share.sharing) {
      this.share.stop();
      return;
    }
    try {
      await this.share.start();
    } catch (err) {
      this.hud.system(err instanceof Error ? err.message : 'Could not start screen sharing.');
    }
  }

  /** Updates the buttons, the in-world screen and the theatre view to match who is sharing. */
  private syncShare(): void {
    const watching = this.share.watching;
    this.hud.setShare({ inside: !!this.interior, sharing: this.share.sharing, watching: watching ? { name: watching.name, stream: watching.stream } : null });
    if (!this.interior) return;
    if (this.share.sharing) this.renderer.setScreen({ kind: 'text', text: 'You are sharing' });
    else if (watching) this.renderer.setScreen({ kind: 'video', stream: watching.stream, key: watching.id });
    else this.renderer.setScreen({ kind: 'text', text: 'No one is sharing' });
  }

  /** First press asks for the microphone. After that it mutes and unmutes. */
  private async toggleMic(): Promise<void> {
    try {
      if (!this.voice.micOn) {
        await this.voice.enable();
        this.hud.setMic('on');
        this.hud.system('Your microphone is on. People near you can hear you.');
      } else {
        this.voice.setMuted(!this.voice.isMuted);
        this.hud.setMic(this.voice.isMuted ? 'muted' : 'on');
      }
    } catch (err) {
      this.hud.system(err instanceof Error ? err.message : 'Could not start the microphone.');
      this.hud.setMic('off');
    }
  }

  private refreshRoster(): void {
    const where = (place: string) => (place ? `in ${this.placeName(place)}` : '');
    this.hud.setRoster([
      { name: `${this.session.self.name} (you)`, color: lookColor(this.session.self.look), status: 'connected', where: where(this.place) },
      ...[...this.session.roster.values()].map((p) => ({ name: p.name, color: lookColor(p.look), status: p.status, where: where(p.place) })),
    ]);
  }

  // ---- renderer callbacks -------------------------------------------------------------------------------

  onPointerWalk(x: number, y: number): void {
    this.walkTarget = { x, y };
    this.walkStuckMs = 0;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  onFrame(time: number, deltaMs: number): void {
    const delta = Math.min(deltaMs, MAX_FRAME_MS);
    const dt = delta / 1000;

    // What the keyboard asks for, turned into a direction in the world by whichever view is showing.
    const { strafe, forward } = this.input.axes();
    let dx = 0;
    let dy = 0;
    if (strafe !== 0 || forward !== 0) {
      this.walkTarget = null; // the keyboard takes over from a click
      ({ dx, dy } = this.renderer.inputToWorld(strafe, forward));
    } else if (this.walkTarget) {
      const tx = this.walkTarget.x - this.x;
      const ty = this.walkTarget.y - this.y;
      if (Math.hypot(tx, ty) < 6) this.walkTarget = null;
      else {
        dx = tx;
        dy = ty;
      }
    }

    const room = this.interior;
    const blocked = room ? (px: number, py: number) => interiorBlocked(room, px, py, COLLIDE_RADIUS, TILE) : (px: number, py: number) => this.world.blocked(px, py, COLLIDE_RADIUS);
    const next = stepPosition(this.x, this.y, dx, dy, dt, blocked);
    // A click on a wall or piece of furniture would otherwise leave us pushing against it forever.
    if (this.walkTarget) {
      this.walkStuckMs = Math.hypot(next.x - this.x, next.y - this.y) < 0.2 ? this.walkStuckMs + delta : 0;
      if (this.walkStuckMs > 350) this.walkTarget = null;
    }
    this.x = next.x;
    this.y = next.y;
    const moving = dx !== 0 || dy !== 0;
    if (moving) this.facing = { x: dx, y: dy };
    this.renderer.animateAvatar(ME, this.x, this.y, moving, this.facing.x, this.facing.y);

    if (room) {
      if (interiorTile(room, Math.floor(this.x / TILE), Math.floor(this.y / TILE)) === I.DOOR) this.exit();
    } else {
      const c = this.renderer.moveOutdoors(this.x, this.y);
      if (c.cx !== this.chunkX || c.cy !== this.chunkY) {
        this.chunkX = c.cx;
        this.chunkY = c.cy;
        this.updatePlaceLabel();
      }
      const door = this.world.doorAt(this.x, this.y);
      if (door) this.enter(door);
    }

    // Send while moving, plus one final update when we stop so others see where we ended up.
    const moved = this.x !== this.sentX || this.y !== this.sentY;
    if (moved && time - this.lastSent >= SEND_INTERVAL_MS) {
      this.session.sendState(this.x, this.y);
      this.sentX = this.x;
      this.sentY = this.y;
      this.lastSent = time;
    }

    if (time - this.lastVoiceTick >= VOICE_TICK_MS) {
      this.lastVoiceTick = time;
      const others = new Map<string, Where>();
      for (const [id, r] of this.remotes) if (r.seen) others.set(id, { x: r.tx, y: r.ty, place: r.place });
      const self = { x: this.x, y: this.y, place: this.place };
      this.voice.update(self, others);
      this.share.update(self, others);
      this.renderer.setSpeaking(ME, this.voice.isSpeaking('self'));
      for (const id of this.remotes.keys()) this.renderer.setSpeaking(id, this.voice.isSpeaking(id));
    }

    for (const [id, r] of this.remotes) {
      if (!r.seen || !this.renderer.avatarVisible(id)) continue;
      const gx = r.tx - r.x;
      const gy = r.ty - r.y;
      const gliding = Math.abs(gx) + Math.abs(gy) > 2;
      r.x = smoothToward(r.x, r.tx, dt);
      r.y = smoothToward(r.y, r.ty, dt);
      this.renderer.animateAvatar(id, r.x, r.y, gliding, gx, gy);
    }
  }

  // ---- tests --------------------------------------------------------------------------------------------

  /** Lets automated tests look inside the game without scraping the canvas. */
  private installTestHooks(): void {
    const idOf = (name: string) => [...this.session.roster].find(([, p]) => p.name === name)?.[0];
    (window as unknown as { __hubbub: unknown }).__hubbub = {
      view: this.renderer.kind,
      positions: () => ({
        me: { x: this.x, y: this.y, place: this.place },
        remotes: Object.fromEntries([...this.remotes].map(([id, r]) => [id, { x: r.x, y: r.y, seen: r.seen, place: r.place, visible: this.renderer.avatarVisible(id) }])),
      }),
      world: () => ({ seed: this.world.seed, checksum: checksumChunk(this.world.chunk(0, 0)), loaded: this.renderer.loadedChunks() }),
      doors: () => this.world.chunk(1, 0).buildings.filter((b) => b.enterable).map((b) => ({ id: b.id, name: b.name, x: (b.doorX + 1) * TILE, y: (b.doorY + 0.5) * TILE })),
      dropServer: () => this.session.debugDropServer(),
      breakLink: (name: string) => {
        const id = idOf(name);
        if (id) this.session.debugBreak(id);
      },
      statuses: () => Object.fromEntries([...this.session.roster.values()].map((p) => [p.name, p.status])),
      room: () => (this.interior ? { spawn: this.interior.spawn, door: { x: (this.interior.doorX + 1) * TILE, y: (this.interior.doorY + 0.5) * TILE }, w: this.interior.w * TILE, h: this.interior.h * TILE } : null),
      avatars: () => ({
        me: { sprite: this.renderer.avatarReady(ME), look: this.session.self.look },
        remotes: Object.fromEntries([...this.remotes].map(([id]) => [this.session.roster.get(id)?.name ?? id, { sprite: this.renderer.avatarReady(id), look: this.session.roster.get(id)?.look }])),
      }),
      share: async () => {
        const w = this.share.watching;
        const stats = w ? await this.session.stats(w.id) : null;
        return { sharing: this.share.sharing, watching: w?.name ?? null, videoBytes: stats?.videoBytes ?? 0, videoFrames: stats?.videoFrames ?? 0, tvShowing: this.renderer.screenShowsVideo() };
      },
      videoBytesFrom: async (name: string) => {
        const id = idOf(name);
        return id ? ((await this.session.stats(id))?.videoBytes ?? 0) : 0;
      },
      voice: async () => ({ micOn: this.voice.micOn, muted: this.voice.isMuted, peers: await this.voice.debug() }),
      teleport: (x: number, y: number) => {
        this.x = x;
        this.y = y;
        this.renderer.placeAvatar(ME, x, y);
        this.renderer.snapCamera(x, y);
        if (!this.interior) this.renderer.moveOutdoors(x, y);
      },
    };
  }
}
