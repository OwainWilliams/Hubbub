import Phaser from 'phaser';
import type { Session } from '../net/session';
import type { Hud } from '../ui/hud';
import { CHUNK, TILE, checksumChunk, type Building } from '../world/generate';
import { I, generateInterior, interiorBlocked, interiorTile, type Interior } from '../world/interior';
import { hashString } from '../world/rng';
import { Voice, type Where } from '../voice/voice';
import { World } from '../world/world';
import { drawChunk, drawInterior, type ChunkArt, type InteriorArt } from './art';
import { COLLIDE_RADIUS, PLAYER_RADIUS, smoothToward, stepPosition } from './movement';

const SEND_INTERVAL_MS = 66; // about 15 updates per second
const BUBBLE_MS = 6000;
const CHUNK_PX = CHUNK * TILE;
const UNLOAD_MARGIN = 1;
const VOICE_TICK_MS = 100;

interface Avatar {
  box: Phaser.GameObjects.Container;
  bubble: Phaser.GameObjects.Text;
  /** Green ring shown while this person is talking. */
  ring: Phaser.GameObjects.Arc;
  bubbleTimer?: Phaser.Time.TimerEvent;
}

interface Remote {
  avatar: Avatar;
  tx: number;
  ty: number;
  seq: number;
  seen: boolean;
  /** '' outdoors, otherwise a building id. */
  place: string;
}

/** Outdoors: an endless generated town. Indoors: the generated inside of one building. Players are placeholder circles for now. */
export class GameScene extends Phaser.Scene {
  private session!: Session;
  private hud!: Hud;
  private world!: World;
  private me!: Avatar;
  private x = 0;
  private y = 0;
  private readonly remotes = new Map<string, Remote>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastSent = 0;
  private sentX = NaN;
  private sentY = NaN;

  private voice!: Voice;
  private lastVoiceTick = 0;

  private readonly chunks = new Map<string, ChunkArt>();
  private chunkX = NaN;
  private chunkY = NaN;
  private interior?: Interior;
  private interiorArt?: InteriorArt;
  /** Where to stand when we walk back out of a building. */
  private exitPoint = { x: 0, y: 0 };

  constructor() {
    super('game');
  }

  init(data: { session: Session; hud: Hud }): void {
    this.session = data.session;
    this.hud = data.hud;
  }

  create(): void {
    this.world = new World(hashString(this.session.code));
    const spawn = this.world.spawnPoint();
    this.x = spawn.x;
    this.y = spawn.y;
    this.me = this.makeAvatar(this.session.self.name, this.session.self.color);
    this.me.box.setPosition(this.x, this.y);

    for (const p of this.session.roster.values()) this.addRemote(p.id, p.name, p.color);

    this.cameras.main.startFollow(this.me.box, true, 0.12, 0.12);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    this.scale.on('resize', () => (this.interior ? this.frameInterior() : this.syncChunks(true)));

    this.voice = new Voice(this.session);
    this.syncChunks(true);
    this.wireSession();
    this.wireHud();
    this.refreshRoster();
    this.installTestHooks();
  }

  // ---- places -------------------------------------------------------------------------------------------

  private get place(): string {
    return this.session.place;
  }

  private enter(b: Building): void {
    this.interior = generateInterior(this.world.seed, b);
    this.exitPoint = { x: (b.doorX + 1) * TILE, y: (b.doorY + 1.5) * TILE };
    this.clearChunks();
    this.interiorArt = drawInterior(this, this.interior);
    this.session.place = b.id;
    // A little scatter so people who walk in together do not stack on one spot.
    this.x = this.interior.spawn.x + (Math.random() - 0.5) * 24;
    this.y = this.interior.spawn.y - Math.random() * 14;
    this.frameInterior();
    this.afterPlaceChange();
  }

  private exit(): void {
    this.interiorArt?.destroy();
    this.interiorArt = undefined;
    this.interior = undefined;
    this.session.place = '';
    this.x = this.exitPoint.x;
    this.y = this.exitPoint.y;
    this.cameras.main.setZoom(1).startFollow(this.me.box, true, 0.12, 0.12);
    this.syncChunks(true);
    this.afterPlaceChange();
  }

  /** Indoors the camera stays still: the whole room, centred, as large as fits without crowding the panels. */
  private frameInterior(): void {
    const room = this.interior;
    if (!room) return;
    const cam = this.cameras.main;
    const w = room.w * TILE;
    const h = room.h * TILE;
    const zoom = Math.max(1, Math.min(2, (cam.width * 0.8) / w, (cam.height * 0.62) / h));
    cam.stopFollow().setZoom(zoom);
    cam.centerOn(w / 2, h / 2 + (cam.height * 0.04) / zoom);
  }

  private afterPlaceChange(): void {
    this.me.box.setPosition(this.x, this.y);
    if (!this.interior) this.cameras.main.centerOn(this.x, this.y);
    this.sentX = NaN; // forces an update to go out this frame
    this.session.sendState(this.x, this.y);
    for (const r of this.remotes.values()) this.applyVisibility(r);
    this.refreshRoster();
    this.updatePlaceLabel();
  }

  private applyVisibility(r: Remote): void {
    r.avatar.box.setVisible(r.seen && r.place === this.place);
  }

  private placeName(place: string): string {
    return this.world.buildingById(place)?.name ?? 'a building';
  }

  private updatePlaceLabel(): void {
    this.hud.setPlace(
      this.interior ? `Inside ${this.interior.name}` : `Outside · square ${Number.isNaN(this.chunkX) ? 0 : this.chunkX}, ${Number.isNaN(this.chunkY) ? 0 : this.chunkY}`,
    );
  }

  // ---- outdoor chunks -----------------------------------------------------------------------------------

  private clearChunks(): void {
    for (const art of this.chunks.values()) art.destroy();
    this.chunks.clear();
    this.chunkX = NaN;
    this.chunkY = NaN;
  }

  private syncChunks(force = false): void {
    if (this.interior) return;
    const cx = Math.floor(this.x / CHUNK_PX);
    const cy = Math.floor(this.y / CHUNK_PX);
    if (!force && cx === this.chunkX && cy === this.chunkY) return;
    this.chunkX = cx;
    this.chunkY = cy;
    this.updatePlaceLabel();

    // Load enough squares to cover the screen however large it is.
    const cam = this.cameras.main;
    const radius = Math.max(1, Math.ceil(Math.max(cam.width, cam.height) / 2 / CHUNK_PX));
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (!this.chunks.has(key)) this.chunks.set(key, drawChunk(this, this.world.chunk(cx + dx, cy + dy)));
      }
    }
    for (const [key, art] of this.chunks) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius + UNLOAD_MARGIN) {
        art.destroy();
        this.chunks.delete(key);
      }
    }
  }

  // ---- network and HUD ----------------------------------------------------------------------------------

  private wireSession(): void {
    const h = this.session.handlers;
    h.peerJoined = (p) => {
      this.addRemote(p.id, p.name, p.color);
      this.hud.system(`${p.name} arrived.`);
      this.refreshRoster();
    };
    h.peerLeft = (id) => {
      const name = this.remotes.get(id)?.avatar.box.getData('name') as string | undefined;
      this.remotes.get(id)?.avatar.box.destroy();
      this.remotes.delete(id);
      if (name) this.hud.system(`${name} left.`);
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
        r.avatar.box.setPosition(m.x, m.y);
      }
      if (changedPlace && previousPlace !== place) {
        this.announceMove(r, previousPlace, place);
        this.refreshRoster();
      }
      this.applyVisibility(r);
    };
    h.chat = (id, text) => {
      const r = this.remotes.get(id);
      if (!r) return;
      this.say(r.avatar, text);
      this.hud.chat(this.session.roster.get(id)?.name ?? 'Someone', text, false);
    };
    h.linkChanged = (_id, status) => {
      this.refreshRoster();
      // Tell a newly connected peer where we are right away instead of waiting for us to move.
      if (status === 'connected') this.session.sendState(this.x, this.y);
    };
    h.serverLost = () => this.hud.system('Lost the connection to the server. People already connected still work, but nobody new can join.');
  }

  private announceMove(r: Remote, from: string, to: string): void {
    const name = r.avatar.box.getData('name') as string;
    const mine = this.place;
    if (to && mine === to) this.hud.system(`${name} came in.`);
    else if (from && mine === from) this.hud.system(`${name} left the room.`);
    else if (!mine && to) this.hud.system(`${name} went into ${this.placeName(to)}.`);
    else if (!mine && from) this.hud.system(`${name} came out of ${this.placeName(from)}.`);
  }

  private wireHud(): void {
    this.hud.onSend = (text) => {
      this.session.sendChat(text);
      this.say(this.me, text);
      this.hud.chat(this.session.self.name, text, true);
    };
    this.hud.onMic = () => void this.toggleMic();
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'm' || e.key === 'M') && document.activeElement?.tagName !== 'INPUT' && this.voice.micOn) this.toggleMic();
    });
    // Typing in the chat box must not walk the character around.
    this.hud.onFocusChange = (focused) => {
      this.input.keyboard!.enabled = !focused;
      if (focused) this.input.keyboard!.resetKeys();
    };
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
      { name: `${this.session.self.name} (you)`, color: this.session.self.color, status: 'connected', where: where(this.place) },
      ...[...this.session.roster.values()].map((p) => ({ name: p.name, color: p.color, status: p.status, where: where(p.place) })),
    ]);
  }

  /** Lets automated tests look inside the game without scraping the canvas. */
  private installTestHooks(): void {
    (window as unknown as { __hubbub: unknown }).__hubbub = {
      positions: () => ({
        me: { x: this.x, y: this.y, place: this.place },
        remotes: Object.fromEntries(
          [...this.remotes].map(([id, r]) => [id, { x: r.avatar.box.x, y: r.avatar.box.y, seen: r.seen, place: r.place, visible: r.avatar.box.visible }]),
        ),
      }),
      world: () => ({ seed: this.world.seed, checksum: checksumChunk(this.world.chunk(0, 0)), loaded: this.chunks.size }),
      doors: () => this.world.chunk(1, 0).buildings.filter((b) => b.enterable).map((b) => ({ id: b.id, name: b.name, x: (b.doorX + 1) * TILE, y: (b.doorY + 0.5) * TILE })),
      room: () => (this.interior ? { spawn: this.interior.spawn, door: { x: (this.interior.doorX + 1) * TILE, y: (this.interior.doorY + 0.5) * TILE }, w: this.interior.w * TILE, h: this.interior.h * TILE } : null),
      voice: async () => ({ micOn: this.voice.micOn, muted: this.voice.isMuted, peers: await this.voice.debug() }),
      teleport: (x: number, y: number) => {
        this.x = x;
        this.y = y;
        this.me.box.setPosition(x, y);
        this.cameras.main.centerOn(x, y);
        this.syncChunks(true);
      },
    };
  }

  // ---- avatars ------------------------------------------------------------------------------------------

  private addRemote(id: string, name: string, color: string): void {
    if (this.remotes.has(id)) return;
    const avatar = this.makeAvatar(name, color);
    avatar.box.setVisible(false); // hidden until their first position arrives
    this.remotes.set(id, { avatar, tx: 0, ty: 0, seq: 0, seen: false, place: '' });
  }

  private makeAvatar(name: string, color: string): Avatar {
    const body = this.add.circle(0, 0, PLAYER_RADIUS, Phaser.Display.Color.HexStringToColor(color).color).setStrokeStyle(3, 0x14181f);
    const label = this.add
      .text(0, PLAYER_RADIUS + 6, name, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#e8dcc0', stroke: '#14181f', strokeThickness: 3 })
      .setOrigin(0.5, 0);
    const bubble = this.add
      .text(0, -PLAYER_RADIUS - 10, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#14181f',
        backgroundColor: '#e8dcc0',
        padding: { x: 8, y: 4 },
        wordWrap: { width: 200 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setVisible(false);
    const ring = this.add.circle(0, 0, PLAYER_RADIUS + 6).setStrokeStyle(3, 0x6fbf73).setVisible(false);
    const box = this.add.container(0, 0, [ring, body, label, bubble]).setData('name', name);
    return { box, bubble, ring };
  }

  private say(a: Avatar, text: string): void {
    a.bubble.setText(text).setVisible(true);
    a.bubbleTimer?.remove();
    a.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => a.bubble.setVisible(false));
  }

  // ---- frame loop ---------------------------------------------------------------------------------------

  update(time: number, delta: number): void {
    const dt = delta / 1000;
    const k = this.keys;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);

    const room = this.interior;
    const blocked = room ? (px: number, py: number) => interiorBlocked(room, px, py, COLLIDE_RADIUS, TILE) : (px: number, py: number) => this.world.blocked(px, py, COLLIDE_RADIUS);
    const next = stepPosition(this.x, this.y, dx, dy, dt, blocked);
    this.x = next.x;
    this.y = next.y;
    this.me.box.setPosition(this.x, this.y).setDepth(this.y);

    if (room) {
      if (interiorTile(room, Math.floor(this.x / TILE), Math.floor(this.y / TILE)) === I.DOOR) this.exit();
    } else {
      this.syncChunks();
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
      this.voice.update({ x: this.x, y: this.y, place: this.place }, others);
      this.me.ring.setVisible(this.voice.isSpeaking('self'));
      for (const [id, r] of this.remotes) r.avatar.ring.setVisible(this.voice.isSpeaking(id));
    }

    for (const r of this.remotes.values()) {
      if (!r.seen || !r.avatar.box.visible) continue;
      const b = r.avatar.box;
      b.setPosition(smoothToward(b.x, r.tx, dt), smoothToward(b.y, r.ty, dt)).setDepth(b.y);
    }
  }
}
