import * as THREE from 'three';
import { CHUNK, T, type Building, type Chunk } from '../../world/generate';
import { GeoBuilder, hash2, shade, tileFloor } from './geo';

/**
 * One square of the town as 3D geometry. This is the 3D counterpart of phaser/art.ts: it reads the same
 * generated tiles and buildings, so the town looks the same shape in both views, and a different tileset
 * (for example Kenney's 3D town kit) can replace this file without touching anything else.
 */

const GRASS = 0x4f6b4f;
const STREET = 0x5a5148;
const PLAZA = 0x7a7060;
const PATH = 0x8a7a62;
const DOORSTEP = 0x4a3f36;
const WALLS = [0x9a7358, 0x8d8a78, 0x7a8d96, 0xa97a62];
const ROOFS = [0x7a3f36, 0x3f4a5e, 0x6b5a3a, 0x4a6040];
const TRUNK = 0x5a4228;
const LEAVES = [0x3a5a3a, 0x44683f];
const INK = 0x14181f;
const WINDOW_LIT = 0xf2d66b;
const WINDOW_DARK = 0x1a222c;

const BASE_BY_CHUNK: Record<Chunk['type'], number> = { houses: GRASS, park: GRASS, plaza: PLAZA, market: PLAZA };

export const WALL_HEIGHT = 3.4;
export const ROOF_RISE = 1.6;
const DOOR_HEIGHT = 2.4;

export interface Sign {
  text: string;
  /** Local to the square, in tiles. */
  x: number;
  y: number;
  z: number;
}

export interface ChunkGeometry {
  ground: THREE.BufferGeometry;
  /** Things lit by the scene's lights. */
  lit: THREE.BufferGeometry | null;
  /** Things that glow on their own: lit windows and lamp bulbs. */
  glow: THREE.BufferGeometry | null;
  /** Soft pools of light on the ground, drawn with transparency. */
  halo: THREE.BufferGeometry | null;
  signs: Sign[];
}

function groundColor(chunk: Chunk, t: number, tx: number, ty: number): THREE.Color {
  let base = BASE_BY_CHUNK[chunk.type];
  if (t === T.STREET) base = STREET;
  else if (t === T.PATH) base = PATH;
  else if (t === T.PLAZA) base = PLAZA;
  else if (t === T.GRASS) base = GRASS;
  else if (t === T.DOOR) base = DOORSTEP;
  // A little variation per tile so big flat areas do not look painted on.
  const v = (hash2(tx + chunk.cx * CHUNK, ty + chunk.cy * CHUNK) - 0.5) * (t === T.STREET ? 0.16 : 0.1);
  return shade(base, v);
}

/** Builds all the geometry for a square. Pure: needs no browser. */
export function buildChunkGeometry(chunk: Chunk): ChunkGeometry {
  const lit = new GeoBuilder();
  const glow = new GeoBuilder();
  const halo = new GeoBuilder();
  const signs: Sign[] = [];
  const tileAt = (x: number, y: number) => (x < 0 || y < 0 || x >= CHUNK || y >= CHUNK ? -1 : chunk.tiles[y * CHUNK + x]);

  const ground = tileFloor(CHUNK, CHUNK, (tx, ty) => groundColor(chunk, chunk.tiles[ty * CHUNK + tx], tx, ty));

  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      const t = chunk.tiles[ty * CHUNK + tx];
      const cx = tx + 0.5;
      const cz = ty + 0.5;
      const wx = tx + chunk.cx * CHUNK;
      const wy = ty + chunk.cy * CHUNK;
      const r = hash2(wx, wy);
      switch (t) {
        case T.TREE: {
          const s = 0.85 + r * 0.5;
          lit.cylinder(cx, 0, cz, 0.12 * s, 0.18 * s, 1.1 * s, TRUNK, 6);
          lit.cone(cx, 0.8 * s, cz, 0.85 * s, 1.5 * s, LEAVES[r < 0.5 ? 0 : 1], 7);
          lit.cone(cx, 1.6 * s, cz, 0.62 * s, 1.3 * s, LEAVES[r < 0.5 ? 1 : 0], 7);
          break;
        }
        case T.LAMP:
          lit.cylinder(cx, 0, cz, 0.05, 0.07, 2.5, INK, 6);
          glow.sphere(cx, 2.65, cz, 0.2, WINDOW_LIT, 8, 6);
          halo.disc(cx, 0.03, cz, 2.4, 0xf2d66b);
          break;
        case T.BENCH:
          lit.box(cx, 0.28, cz, 0.95, 0.1, 0.42, 0x6b4a36);
          lit.box(cx, 0.5, cz - 0.18, 0.95, 0.4, 0.08, 0x6b4a36);
          lit.box(cx - 0.4, 0, cz, 0.08, 0.28, 0.36, INK);
          lit.box(cx + 0.4, 0, cz, 0.08, 0.28, 0.36, INK);
          break;
        case T.FOUNTAIN: {
          // One fountain per 4 x 4 block, built from its top-left tile.
          if (tileAt(tx - 1, ty) !== T.FOUNTAIN && tileAt(tx, ty - 1) !== T.FOUNTAIN) {
            const mx = tx + 2;
            const mz = ty + 2;
            lit.cylinder(mx, 0, mz, 1.9, 2.0, 0.55, 0x8d8a82, 16);
            lit.cylinder(mx, 0.45, mz, 1.65, 1.65, 0.12, 0x3d6a8a, 16);
            lit.cylinder(mx, 0, mz, 0.22, 0.3, 1.5, 0x9a978f, 8);
            lit.cylinder(mx, 1.35, mz, 0.7, 0.4, 0.2, 0x8d8a82, 12);
            glow.cylinder(mx, 1.5, mz, 0.5, 0.5, 0.05, 0x6aa6cc, 12);
          }
          break;
        }
        case T.STALL: {
          const stripe = (wx + wy) % 2 === 0 ? 0xa9573b : 0xe8dcc0;
          lit.box(cx, 0, cz, 0.96, 0.85, 0.96, 0x6b4a36);
          lit.box(cx, 2.05, cz, 0.98, 0.1, 0.98, stripe);
          for (const [px, pz] of [[tx + 0.06, ty + 0.06], [tx + 0.94, ty + 0.06], [tx + 0.06, ty + 0.94], [tx + 0.94, ty + 0.94]]) {
            if (tileAt(Math.floor(px + (px > cx ? 0.1 : -0.1)), Math.floor(pz + (pz > cz ? 0.1 : -0.1))) !== T.STALL) lit.cylinder(px, 0, pz, 0.04, 0.04, 2.05, 0x4a3a2a, 5);
          }
          lit.box(cx, 0.85, cz, 0.5, 0.18, 0.5, (wx * 3 + wy) % 3 === 0 ? 0xa9573b : (wx + wy) % 3 === 1 ? 0xd9a441 : 0x5f7a5a);
          break;
        }
      }
    }
  }

  for (const b of chunk.buildings) buildBuilding(b, chunk, lit, glow, signs);

  return { ground, lit: lit.build(), glow: glow.build(), halo: halo.build(), signs };
}

function buildBuilding(b: Building, chunk: Chunk, lit: GeoBuilder, glow: GeoBuilder, signs: Sign[]): void {
  const x0 = b.x - chunk.cx * CHUNK;
  const z0 = b.y - chunk.cy * CHUNK;
  const x1 = x0 + b.w;
  const z1 = z0 + b.h;
  const H = WALL_HEIGHT + (b.style % 2) * 0.6;
  const wall = WALLS[b.style];
  const dx = b.doorX - chunk.cx * CHUNK;
  const dz = b.doorY - chunk.cy * CHUNK;

  if (b.enterable) {
    // The doorway is a covered recess: the wall is built in pieces around a two tile wide, one tile deep bay.
    lit.span(x0, dx, 0, H, z0, z1, wall);
    lit.span(dx + 2, x1, 0, H, z0, z1, wall);
    lit.span(dx, dx + 2, 0, H, z0, dz, wall);
    lit.span(dx, dx + 2, DOOR_HEIGHT, H, dz, z1, wall);
    lit.box(dx + 1, 0, dz + 0.04, 1.7, DOOR_HEIGHT - 0.1, 0.08, 0x3a2a20);
    glow.sphere(dx + 1.55, 1.2, dz + 0.12, 0.05, 0xd9a441, 5, 4); // door handle
    lit.span(dx - 0.12, dx, 0, DOOR_HEIGHT + 0.12, dz, z1, 0x5a4228);
    lit.span(dx + 2, dx + 2.12, 0, DOOR_HEIGHT + 0.12, dz, z1, 0x5a4228);
    glow.sphere(dx - 0.45, 2.0, z1 + 0.15, 0.14, WINDOW_LIT, 6, 5); // porch lamp
    lit.cylinder(dx - 0.45, 1.9, z1 + 0.15, 0.03, 0.03, 0.4, INK, 4);
  } else {
    lit.span(x0, x1, 0, H, z0, z1, wall);
    lit.box(dx + 1, 0, z1 + 0.02, 1.7, DOOR_HEIGHT - 0.2, 0.06, shade(wall, -0.35));
  }

  // Roof: pitched, with an overhang, and a chimney.
  lit.gable(x0 - 0.35, x1 + 0.35, z0 - 0.35, z1 + 0.35, H, ROOF_RISE, ROOFS[b.style]);
  lit.box(x0 + b.w * 0.75, H + 0.4, (z0 + z1) / 2 - 0.3, 0.5, 1.6, 0.5, 0x6a5a50);

  // Windows on the front and sides, skipping the doorway.
  const addWindow = (wx: number, wz: number, faceX: boolean) => {
    const on = hash2(Math.floor(wx * 7) + b.x, Math.floor(wz * 7) + b.y) > 0.35;
    const w = 0.7;
    const h = 0.9;
    const t = 0.04;
    const builder = on ? glow : lit;
    if (faceX) builder.box(wx, 1.5, wz, t, h, w, on ? WINDOW_LIT : WINDOW_DARK);
    else builder.box(wx, 1.5, wz, w, h, t, on ? WINDOW_LIT : WINDOW_DARK);
  };
  for (let wx = x0 + 1; wx < x1 - 0.5; wx += 1.7) {
    if (wx > dx - 0.9 && wx < dx + 2.9) continue;
    addWindow(wx + 0.35, z1 + 0.02, false);
    addWindow(wx + 0.35, z0 - 0.02, false);
  }
  for (let wz = z0 + 1; wz < z1 - 0.8; wz += 1.9) {
    addWindow(x0 - 0.02, wz + 0.4, true);
    addWindow(x1 + 0.02, wz + 0.4, true);
  }

  if (b.enterable) signs.push({ text: b.name, x: (x0 + x1) / 2, y: H + ROOF_RISE + 0.9, z: z1 - 0.2 });
}

/** Vertex colours already hold the look; these materials just light them. */
export function chunkMaterials() {
  return {
    ground: new THREE.MeshLambertMaterial({ vertexColors: true }),
    lit: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    halo: new THREE.MeshBasicMaterial({ color: 0xf2d66b, transparent: true, opacity: 0.16, depthWrite: false }),
  };
}

export type ChunkMaterials = ReturnType<typeof chunkMaterials>;
