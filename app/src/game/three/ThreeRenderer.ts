import * as THREE from 'three';
import type { Look } from '../../avatar/look';
import { CHUNK, TILE } from '../../world/generate';
import type { Interior } from '../../world/interior';
import type { World } from '../../world/world';
import { ME, type Renderer, type RendererHost, type ScreenContent } from '../renderer';
import { buildAvatarModel, disposeObject, type AvatarModel } from './avatarMesh';
import { INDOOR, INDOOR_START, OUTDOOR, OUTDOOR_START, cameraOffset, clampOrbit, headingFor, inputToGround, turnToward, type Orbit } from './camera';
import { buildChunkGeometry, chunkMaterials, type ChunkMaterials } from './chunkMesh';
import { buildInteriorGeometry } from './interiorMesh';
import { nameTag, screenTextTexture, speechBubble } from './labels';

/** Pixels (the game's units) to world units. */
const S = 1 / TILE;
const LOAD_RADIUS = 2;
const KEEP_RADIUS = 3;
const BUILDS_PER_FRAME = 1;
const BUBBLE_MS = 6000;

const OUTDOOR_SKY = 0x2f3f55;
const INDOOR_SKY = 0x17110d;

interface Avatar3D {
  root: THREE.Group;
  model: AvatarModel;
  label: THREE.Sprite;
  ring: THREE.Mesh;
  bubble?: THREE.Sprite;
  bubbleTimer?: number;
  heading: number;
  targetHeading: number;
  moving: boolean;
  phase: number;
  speaking: boolean;
}

interface ChunkObject {
  group: THREE.Group;
  sprites: THREE.Sprite[];
}

/** The 3D view: the same generated town, drawn with three.js and seen from a camera that orbits the player. */
export class ThreeRenderer implements Renderer {
  readonly kind = '3d' as const;

  private host!: RendererHost;
  private gl!: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private readonly mats: ChunkMaterials = chunkMaterials();
  private stars!: THREE.Points;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;

  private world?: World;
  private readonly chunks = new Map<string, ChunkObject>();
  private queue: Array<{ cx: number; cy: number }> = [];
  private lastChunk = '';

  private interior?: Interior;
  private interiorGroup?: THREE.Group;
  private screenMesh?: THREE.Mesh;
  private screen: { kind: 'text' | 'video'; key: string; texture: THREE.Texture; video?: HTMLVideoElement } | null = null;

  private readonly avatars = new Map<string, Avatar3D>();

  private orbit: Orbit = { ...OUTDOOR_START };
  private savedOutdoorOrbit: Orbit | null = null;
  private readonly target = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private last = 0;

  // ---- start up -----------------------------------------------------------------------------------------

  start(host: RendererHost): Promise<void> {
    this.host = host;
    const container = document.getElementById('game')!;
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const el = this.gl.domElement;
    el.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    container.append(el);

    this.scene.background = new THREE.Color(OUTDOOR_SKY);
    this.scene.fog = new THREE.Fog(OUTDOOR_SKY, 24, 76);
    this.hemi = new THREE.HemisphereLight(0xa9bddb, 0x4a3f33, 1.7);
    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    this.sun.position.set(-30, 50, 24);
    this.scene.add(this.hemi, this.sun);
    this.addStars();

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      this.gl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();

    this.wirePointer(el);
    window.addEventListener('keydown', (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // Test hook: lets screenshots and tests move the camera.
    (window as unknown as { __hubbub3d: unknown }).__hubbub3d = {
      setOrbit: (o: Partial<Orbit>) => Object.assign(this.orbit, o),
      orbit: () => ({ ...this.orbit }),
    };

    this.gl.setAnimationLoop((t) => this.frame(t));
    return Promise.resolve();
  }

  private addStars(): void {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Random points on the upper half of a big sphere.
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.9 + 0.1);
      pos.set([Math.sin(v) * Math.cos(u) * 300, Math.cos(v) * 300, Math.sin(v) * Math.sin(u) * 300], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8dcc0, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  // ---- frame loop ---------------------------------------------------------------------------------------

  private frame(t: number): void {
    const deltaMs = this.last ? t - this.last : 16;
    this.last = t;
    const dt = Math.min(deltaMs, 100) / 1000;

    this.host.onFrame(t, deltaMs);

    // Q and E turn the camera.
    const turn = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    if (turn) this.orbit.yaw -= turn * 1.8 * dt;

    this.buildQueued();
    this.updateAvatars(dt, t);
    this.updateCamera(dt);
    this.gl.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    const me = this.avatars.get(ME);
    if (me) this.target.lerp(this.focusPoint(me.root.position), 1 - Math.exp(-12 * dt));
    this.orbit = clampOrbit(this.orbit, this.interior ? INDOOR : OUTDOOR);
    const o = cameraOffset(this.orbit);
    this.camera.position.set(this.target.x + o.x, this.target.y + o.y, this.target.z + o.z);
    this.camera.lookAt(this.target.x, this.target.y + 0.9, this.target.z);
    this.stars.position.copy(this.camera.position);
  }

  // ---- places -------------------------------------------------------------------------------------------

  showOutdoors(world: World, x: number, y: number): void {
    this.disposeInterior();
    this.world = world;
    if (this.savedOutdoorOrbit) {
      this.orbit = this.savedOutdoorOrbit;
      this.savedOutdoorOrbit = null;
    }
    this.setLook(false);
    this.queue = [];
    this.lastChunk = '';
    this.loadAround(x, y, true);
    this.lastChunk = this.chunkKeyOf(x, y);
  }

  moveOutdoors(x: number, y: number): { cx: number; cy: number } {
    const cx = Math.floor(x / (CHUNK * TILE));
    const cy = Math.floor(y / (CHUNK * TILE));
    if (this.world && !this.interior && `${cx},${cy}` !== this.lastChunk) {
      this.lastChunk = `${cx},${cy}`;
      this.loadAround(x, y, false);
    }
    return { cx, cy };
  }

  private chunkKeyOf(x: number, y: number): string {
    return `${Math.floor(x / (CHUNK * TILE))},${Math.floor(y / (CHUNK * TILE))}`;
  }

  loadedChunks(): number {
    return this.chunks.size;
  }

  /** Wants every square within LOAD_RADIUS. The nearest are built straight away, the rest a few per frame. */
  private loadAround(x: number, y: number, immediate: boolean): void {
    if (!this.world) return;
    const cx = Math.floor(x / (CHUNK * TILE));
    const cy = Math.floor(y / (CHUNK * TILE));
    const wanted: Array<{ cx: number; cy: number; d: number }> = [];
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
        if (!this.chunks.has(`${cx + dx},${cy + dy}`)) wanted.push({ cx: cx + dx, cy: cy + dy, d: Math.max(Math.abs(dx), Math.abs(dy)) * 10 + Math.hypot(dx, dy) });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    this.queue = [];
    for (const w of wanted) {
      if (immediate || w.d < 20) this.buildChunk(w.cx, w.cy); // the ring right around you must not pop in late
      else this.queue.push({ cx: w.cx, cy: w.cy });
    }
    for (const [key, obj] of this.chunks) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > KEEP_RADIUS) {
        this.disposeChunk(obj);
        this.chunks.delete(key);
      }
    }
  }

  private buildQueued(): void {
    for (let i = 0; i < BUILDS_PER_FRAME && this.queue.length; i++) {
      const next = this.queue.shift()!;
      if (!this.chunks.has(`${next.cx},${next.cy}`)) this.buildChunk(next.cx, next.cy);
    }
  }

  private buildChunk(cx: number, cy: number): void {
    if (!this.world) return;
    const key = `${cx},${cy}`;
    if (this.chunks.has(key)) return;
    const g = buildChunkGeometry(this.world.chunk(cx, cy));
    const group = new THREE.Group();
    group.position.set(cx * CHUNK, 0, cy * CHUNK);
    group.add(new THREE.Mesh(g.ground, this.mats.ground));
    if (g.lit) group.add(new THREE.Mesh(g.lit, this.mats.lit));
    if (g.glow) group.add(new THREE.Mesh(g.glow, this.mats.glow));
    if (g.halo) {
      const halo = new THREE.Mesh(g.halo, this.mats.halo);
      halo.renderOrder = 1;
      group.add(halo);
    }
    const sprites = g.signs.map((s) => {
      const sp = nameTag(s.text);
      sp.position.set(s.x, s.y, s.z);
      sp.scale.multiplyScalar(1.5);
      group.add(sp);
      return sp;
    });
    this.scene.add(group);
    this.chunks.set(key, { group, sprites });
  }

  private disposeChunk(obj: ChunkObject): void {
    this.scene.remove(obj.group);
    obj.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose(); // the materials are shared by every square
    });
    for (const s of obj.sprites) {
      s.material.map?.dispose();
      s.material.dispose();
    }
  }

  private clearChunks(): void {
    for (const obj of this.chunks.values()) this.disposeChunk(obj);
    this.chunks.clear();
    this.queue = [];
    this.lastChunk = '';
  }

  showInterior(room: Interior): void {
    this.savedOutdoorOrbit ??= { ...this.orbit };
    this.clearChunks();
    this.disposeInterior();
    this.interior = room;

    const g = buildInteriorGeometry(room);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(g.floor, this.mats.ground));
    if (g.lit) group.add(new THREE.Mesh(g.lit, this.mats.lit));
    if (g.glow) group.add(new THREE.Mesh(g.glow, this.mats.glow));
    for (const l of g.lights) {
      const light = new THREE.PointLight(0xffc27a, 34, 20, 1.4);
      light.position.set(l.x, l.y, l.z);
      group.add(light);
    }
    const screenMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(g.screen.w, g.screen.h), screenMat);
    this.screenMesh.position.set(g.screen.x, g.screen.y, g.screen.z + 0.06);
    group.add(this.screenMesh);
    this.scene.add(group);
    this.interiorGroup = group;

    this.setLook(true);
    this.orbit = clampOrbit({ ...INDOOR_START }, INDOOR);
  }

  private disposeInterior(): void {
    this.clearScreen();
    if (this.interiorGroup) {
      this.scene.remove(this.interiorGroup);
      this.interiorGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          if (m === this.screenMesh) (m.material as THREE.Material).dispose();
        }
      });
    }
    this.interiorGroup = undefined;
    this.screenMesh = undefined;
    this.interior = undefined;
  }

  /** Dusk outdoors, warm lamplight inside. */
  private setLook(indoor: boolean): void {
    const sky = indoor ? INDOOR_SKY : OUTDOOR_SKY;
    (this.scene.background as THREE.Color).setHex(sky);
    this.scene.fog = indoor ? new THREE.Fog(sky, 40, 90) : new THREE.Fog(sky, 24, 76);
    this.hemi.color.setHex(indoor ? 0xffe6cc : 0xa9bddb);
    this.hemi.groundColor.setHex(indoor ? 0x5a4636 : 0x4a3f33);
    this.hemi.intensity = indoor ? 1.5 : 1.7;
    this.sun.intensity = indoor ? 0.6 : 2.4;
    this.stars.visible = !indoor;
  }

  // ---- the wall screen ----------------------------------------------------------------------------------

  private clearScreen(): void {
    if (!this.screen) return;
    this.screen.texture.dispose();
    if (this.screen.video) {
      this.screen.video.pause();
      this.screen.video.srcObject = null;
    }
    this.screen = null;
  }

  setScreen(content: ScreenContent): void {
    if (!this.screenMesh) return;
    const key = content.kind === 'text' ? `text:${content.text}` : `video:${content.key}`;
    if (this.screen?.key === key) return;
    this.clearScreen();
    const mat = this.screenMesh.material as THREE.MeshBasicMaterial;
    if (content.kind === 'text') {
      const texture = screenTextTexture(content.text);
      this.screen = { kind: 'text', key, texture };
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = content.stream;
      void video.play().catch(() => {});
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.screen = { kind: 'video', key, texture, video };
    }
    mat.map = this.screen.texture;
    mat.needsUpdate = true;
  }

  screenShowsVideo(): boolean {
    return this.screen?.kind === 'video';
  }

  // ---- people -------------------------------------------------------------------------------------------

  addAvatar(id: string, name: string, look: Look): void {
    if (this.avatars.has(id)) return;
    const model = buildAvatarModel(look);
    const root = new THREE.Group();
    root.add(model.group);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    root.add(shadow);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 28), new THREE.MeshBasicMaterial({ color: 0x6fbf73, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    root.add(ring);

    const label = nameTag(name);
    label.scale.multiplyScalar(1.3);
    label.position.set(0, model.height + 0.35, 0);
    root.add(label);

    this.scene.add(root);
    this.avatars.set(id, { root, model, label, ring, heading: 0, targetHeading: 0, moving: false, phase: 0, speaking: false });
  }

  removeAvatar(id: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    window.clearTimeout(a.bubbleTimer);
    this.scene.remove(a.root);
    disposeObject(a.root);
    this.avatars.delete(id);
  }

  placeAvatar(id: string, x: number, y: number): void {
    this.avatars.get(id)?.root.position.set(x * S, 0, y * S);
  }

  animateAvatar(id: string, x: number, y: number, moving: boolean, dirX: number, dirY: number): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.root.position.set(x * S, 0, y * S);
    a.moving = moving;
    if (Math.abs(dirX) + Math.abs(dirY) > 0.01) a.targetHeading = headingFor(dirX, dirY);
  }

  private updateAvatars(dt: number, t: number): void {
    for (const a of this.avatars.values()) {
      if (!a.root.visible) continue;
      a.heading = turnToward(a.heading, a.targetHeading, dt);
      a.model.group.rotation.y = a.heading;
      if (a.moving) a.phase += dt * 10;
      const swing = a.moving ? Math.sin(a.phase) * 0.7 : 0;
      a.model.arms[0].rotation.x = swing;
      a.model.arms[1].rotation.x = -swing;
      a.model.body.position.y = a.moving ? Math.abs(Math.sin(a.phase)) * 0.07 : 0;
      if (a.speaking) a.ring.scale.setScalar(1 + Math.sin(t * 0.012) * 0.1);
    }
  }

  setAvatarVisible(id: string, visible: boolean): void {
    const a = this.avatars.get(id);
    if (a) a.root.visible = visible;
  }

  avatarVisible(id: string): boolean {
    return this.avatars.get(id)?.root.visible ?? false;
  }

  avatarReady(id: string): boolean {
    return this.avatars.has(id); // built straight away; there is no picture to wait for
  }

  say(id: string, text: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    this.dropBubble(a);
    const bubble = speechBubble(text);
    bubble.position.set(0, a.model.height + 0.75, 0);
    a.root.add(bubble);
    a.bubble = bubble;
    a.bubbleTimer = window.setTimeout(() => this.dropBubble(a), BUBBLE_MS);
  }

  private dropBubble(a: Avatar3D): void {
    window.clearTimeout(a.bubbleTimer);
    if (!a.bubble) return;
    a.root.remove(a.bubble);
    a.bubble.material.map?.dispose();
    a.bubble.material.dispose();
    a.bubble = undefined;
  }

  setSpeaking(id: string, on: boolean): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.speaking = on;
    a.ring.visible = on;
  }

  // ---- camera and input ---------------------------------------------------------------------------------

  snapCamera(x: number, y: number): void {
    this.target.copy(this.focusPoint(new THREE.Vector3(x * S, 0, y * S)));
  }

  /**
   * What the camera looks at. Outdoors that is the player. Indoors it is part of the way to the middle of the
   * room, so the wall screen at the far end stays in view while you stand near the door.
   */
  private focusPoint(player: THREE.Vector3): THREE.Vector3 {
    const room = this.interior;
    if (!room) return player;
    return new THREE.Vector3(player.x + (room.w / 2 - player.x) * 0.6, 0, player.z + (room.h / 2 - player.z) * 0.6);
  }

  inputToWorld(strafe: number, forward: number): { dx: number; dy: number } {
    return inputToGround(strafe, forward, this.orbit.yaw);
  }

  /** Drag to turn the camera, scroll or pinch to zoom, click or tap the ground to walk there. */
  private wirePointer(el: HTMLCanvasElement): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0 };
    let dragged = false;
    let pinch = 0;

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        dragged = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        dragged = true; // two fingers are never a tap
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) this.orbit.distance *= pinch / d;
        pinch = d;
        return;
      }
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) dragged = true;
      if (dragged) {
        this.orbit.yaw -= dx * 0.007;
        this.orbit.pitch += dy * 0.005;
      }
    });
    const end = (e: PointerEvent) => {
      const was = pointers.size;
      pointers.delete(e.pointerId);
      if (e.type === 'pointerup' && was === 1 && !dragged && e.button === 0) {
        const hit = this.groundPoint(e.clientX, e.clientY);
        if (hit) this.host.onPointerWalk(hit.x / S, hit.z / S);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbit.distance *= Math.exp(e.deltaY * 0.0012);
      },
      { passive: false },
    );
  }

  /** Where a point on the screen meets the ground, in world units, or null if it points at the sky. */
  private groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }
}
