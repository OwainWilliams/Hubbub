import Phaser from 'phaser';
import { lookColor, lookKey, type Look } from '../../avatar/look';
import { AVATAR_H, AVATAR_W, avatarDataUrl } from '../../avatar/svg';
import { CHUNK, TILE } from '../../world/generate';
import type { Interior } from '../../world/interior';
import type { World } from '../../world/world';
import { PLAYER_RADIUS } from '../movement';
import { ME, type Renderer, type RendererHost, type ScreenContent } from '../renderer';
import { drawChunk, drawInterior, type ChunkArt, type InteriorArt } from './art';

const CHUNK_PX = CHUNK * TILE;
const UNLOAD_MARGIN = 1;
const BUBBLE_MS = 6000;
const AVATAR_SCALE = 0.55;
const AVATAR_SCREEN_H = Math.round(AVATAR_H * AVATAR_SCALE);

interface Avatar {
  box: Phaser.GameObjects.Container;
  bubble: Phaser.GameObjects.Text;
  /** Green ring shown while this person is talking. */
  ring: Phaser.GameObjects.Arc;
  /** Stand-in circle shown until the avatar picture has loaded. */
  placeholder: Phaser.GameObjects.Arc;
  sprite?: Phaser.GameObjects.Image;
  facing: 1 | -1;
  moving: boolean;
  bubbleTimer?: Phaser.Time.TimerEvent;
}

interface Tv {
  video: HTMLVideoElement;
  texture: Phaser.Textures.CanvasTexture;
  image: Phaser.GameObjects.Image;
  lastDraw: number;
  key: string;
}

/** The 2D view: a flat top-down town drawn with Phaser. */
export class PhaserRenderer implements Renderer {
  readonly kind = '2d' as const;

  private host!: RendererHost;
  private scene!: Phaser.Scene;
  private world?: World;
  private readonly avatars = new Map<string, Avatar>();
  private readonly chunks = new Map<string, ChunkArt>();
  private chunkX = NaN;
  private chunkY = NaN;
  private interior?: Interior;
  private interiorArt?: InteriorArt;
  private tv?: Tv;
  private now = 0;
  private readonly pendingTextures = new Map<string, Promise<string>>();

  start(host: RendererHost): Promise<void> {
    this.host = host;
    return new Promise((resolve) => {
      const renderer = this;
      class PhaserScene extends Phaser.Scene {
        constructor() {
          super('game');
        }
        create(): void {
          renderer.scene = this;
          this.input.on('pointerdown', (p: Phaser.Input.Pointer) => renderer.host.onPointerWalk(p.worldX, p.worldY));
          this.scale.on('resize', () => (renderer.interior ? renderer.frameInterior() : renderer.syncChunks(true)));
          resolve();
        }
        update(time: number, delta: number): void {
          renderer.now = time;
          renderer.host.onFrame(time, delta);
          renderer.drawTv(time);
        }
      }
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        backgroundColor: '#14181f',
        pixelArt: true,
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        scene: [],
      });
      game.scene.add('game', PhaserScene, true);
    });
  }

  // ---- places -------------------------------------------------------------------------------------------

  showOutdoors(world: World, x: number, y: number): void {
    this.world = world;
    this.interiorArt?.destroy();
    this.interiorArt = undefined;
    this.interior = undefined;
    this.clearTv();
    const cam = this.scene.cameras.main;
    cam.setZoom(1);
    const me = this.avatars.get(ME);
    if (me) cam.startFollow(me.box, true, 0.12, 0.12);
    cam.centerOn(x, y);
    this.syncChunks(true, x, y);
  }

  moveOutdoors(x: number, y: number): { cx: number; cy: number } {
    this.syncChunks(false, x, y);
    return { cx: this.chunkX, cy: this.chunkY };
  }

  loadedChunks(): number {
    return this.chunks.size;
  }

  showInterior(room: Interior): void {
    this.clearChunks();
    this.interior = room;
    this.interiorArt = drawInterior(this.scene, room);
    this.frameInterior();
  }

  private clearChunks(): void {
    for (const art of this.chunks.values()) art.destroy();
    this.chunks.clear();
    this.chunkX = NaN;
    this.chunkY = NaN;
  }

  private syncChunks(force: boolean, px?: number, py?: number): void {
    if (this.interior || !this.world) return;
    const me = this.avatars.get(ME);
    const x = px ?? me?.box.x ?? 0;
    const y = py ?? me?.box.y ?? 0;
    const cx = Math.floor(x / CHUNK_PX);
    const cy = Math.floor(y / CHUNK_PX);
    if (!force && cx === this.chunkX && cy === this.chunkY) return;
    this.chunkX = cx;
    this.chunkY = cy;

    // Load enough squares to cover the screen however large it is.
    const cam = this.scene.cameras.main;
    const radius = Math.max(1, Math.ceil(Math.max(cam.width, cam.height) / 2 / CHUNK_PX));
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (!this.chunks.has(key)) this.chunks.set(key, drawChunk(this.scene, this.world.chunk(cx + dx, cy + dy)));
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

  /** Indoors the camera stays still: the whole room, centred, as large as fits without crowding the panels. */
  private frameInterior(): void {
    const room = this.interior;
    if (!room) return;
    const cam = this.scene.cameras.main;
    const w = room.w * TILE;
    const h = room.h * TILE;
    const zoom = Math.max(1, Math.min(2, (cam.width * 0.8) / w, (cam.height * 0.62) / h));
    cam.stopFollow().setZoom(zoom);
    cam.centerOn(w / 2, h / 2 + (cam.height * 0.04) / zoom);
  }

  // ---- the wall screen ----------------------------------------------------------------------------------

  setScreen(content: ScreenContent): void {
    const art = this.interiorArt;
    if (!art) return;
    if (content.kind === 'text') {
      this.clearTv();
      art.setScreenText(content.text);
      return;
    }
    if (this.tv?.key === content.key) return;
    this.clearTv();
    const rect = art.screenRect;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = content.stream;
    void video.play().catch(() => {});
    const textureKey = 'tv-canvas';
    if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    const texture = this.scene.textures.createCanvas(textureKey, 512, Math.round((512 * rect.h) / rect.w));
    if (!texture) return;
    const image = this.scene.add.image(rect.x + rect.w / 2, rect.y + rect.h / 2, textureKey).setDisplaySize(rect.w, rect.h).setDepth(-1e9 + 2);
    this.tv = { video, texture, image, lastDraw: 0, key: content.key };
    art.setScreenText(null);
  }

  screenShowsVideo(): boolean {
    return !!this.tv;
  }

  private clearTv(): void {
    if (!this.tv) return;
    this.tv.video.srcObject = null;
    this.tv.image.destroy();
    this.scene.textures.remove('tv-canvas');
    this.tv = undefined;
  }

  /** Copies the current video frame onto the in-world screen, keeping the picture's shape. */
  private drawTv(time: number): void {
    const tv = this.tv;
    if (!tv || time - tv.lastDraw < 66 || tv.video.readyState < 2 || !tv.video.videoWidth) return;
    tv.lastDraw = time;
    const ctx = tv.texture.context;
    const { width: cw, height: ch } = tv.texture;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / tv.video.videoWidth, ch / tv.video.videoHeight);
    const w = tv.video.videoWidth * scale;
    const h = tv.video.videoHeight * scale;
    ctx.drawImage(tv.video, (cw - w) / 2, (ch - h) / 2, w, h);
    tv.texture.refresh();
  }

  // ---- people -------------------------------------------------------------------------------------------

  addAvatar(id: string, name: string, look: Look): void {
    if (this.avatars.has(id)) return;
    const s = this.scene;
    const placeholder = s.add.circle(0, 0, PLAYER_RADIUS, Phaser.Display.Color.HexStringToColor(lookColor(look)).color).setStrokeStyle(3, 0x14181f);
    const label = s.add.text(0, 20, name, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#e8dcc0', stroke: '#14181f', strokeThickness: 3 }).setOrigin(0.5, 0);
    const bubble = s.add
      .text(0, -AVATAR_SCREEN_H - 6, '', {
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
    const ring = s.add.circle(0, 8, PLAYER_RADIUS + 8).setStrokeStyle(3, 0x6fbf73).setVisible(false);
    const box = s.add.container(0, 0, [ring, placeholder, label, bubble]);
    const avatar: Avatar = { box, bubble, ring, placeholder, facing: 1, moving: false };
    this.avatars.set(id, avatar);
    void this.avatarTexture(look).then((key) => {
      if (!box.scene) return; // the person left before their picture loaded
      const sprite = s.add.image(0, 16, key).setOrigin(0.5, 152 / AVATAR_H).setScale(AVATAR_SCALE);
      box.addAt(sprite, 1);
      placeholder.destroy();
      avatar.sprite = sprite;
    });
  }

  removeAvatar(id: string): void {
    this.avatars.get(id)?.box.destroy();
    this.avatars.delete(id);
  }

  placeAvatar(id: string, x: number, y: number): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.box.setPosition(x, y).setDepth(y);
  }

  animateAvatar(id: string, x: number, y: number, moving: boolean, dirX: number): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.box.setPosition(x, y).setDepth(y);
    a.moving = moving;
    if (Math.abs(dirX) > 0.01) a.facing = dirX > 0 ? 1 : -1;
    if (a.sprite) {
      a.sprite.setFlipX(a.facing < 0);
      a.sprite.y = 16 + (a.moving ? Math.sin(this.now * 0.02) * 2.5 : 0);
    }
  }

  setAvatarVisible(id: string, visible: boolean): void {
    this.avatars.get(id)?.box.setVisible(visible);
  }

  avatarVisible(id: string): boolean {
    return this.avatars.get(id)?.box.visible ?? false;
  }

  avatarReady(id: string): boolean {
    return !!this.avatars.get(id)?.sprite;
  }

  say(id: string, text: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.bubble.setText(text).setVisible(true);
    a.bubbleTimer?.remove();
    a.bubbleTimer = this.scene.time.delayedCall(BUBBLE_MS, () => a.bubble.setVisible(false));
  }

  setSpeaking(id: string, on: boolean): void {
    this.avatars.get(id)?.ring.setVisible(on);
  }

  /** Loads the picture for a look once and shares it between everyone who looks the same. */
  private avatarTexture(look: Look): Promise<string> {
    const key = `avatar:${lookKey(look)}`;
    if (this.scene.textures.exists(key)) return Promise.resolve(key);
    let p = this.pendingTextures.get(key);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image(AVATAR_W, AVATAR_H);
        img.onload = () => {
          if (!this.scene.textures.exists(key)) this.scene.textures.addImage(key, img);
          resolve(key);
        };
        img.src = avatarDataUrl(look);
      });
      this.pendingTextures.set(key, p);
    }
    return p;
  }

  // ---- camera and input ---------------------------------------------------------------------------------

  snapCamera(x: number, y: number): void {
    if (!this.interior) this.scene.cameras.main.centerOn(x, y);
  }

  inputToWorld(strafe: number, forward: number): { dx: number; dy: number } {
    return { dx: strafe, dy: -forward };
  }
}
