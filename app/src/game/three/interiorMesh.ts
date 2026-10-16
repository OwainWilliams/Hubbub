import * as THREE from 'three';
import { I, type Interior } from '../../world/interior';
import { GeoBuilder, hash2, shade, tileFloor } from './geo';

/** The inside of a building as 3D geometry, built from the same generated tiles as the 2D interior. */

const FLOOR_A = 0x7a5a44;
const FLOOR_B = 0x6f513c;
const RUG = 0x8c3f3a;
const MAT = 0x3a2a20;
const WALL = 0x6a5446;
const WALL_TOP = 0x8a7060;
const INK = 0x14181f;
const GLOW = 0xf2d66b;

/** Walls stay low enough that the (always high) indoor camera looks over them. */
export const NORTH_WALL_HEIGHT = 3.2;
export const SIDE_WALL_HEIGHT = 2.4;
export const SCREEN_Y = 1.0;
export const SCREEN_W = 4;
export const SCREEN_H = 2.25; // 16:9

export interface InteriorGeometry {
  floor: THREE.BufferGeometry;
  lit: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Where the wall screen goes: centre of its face, in tiles, and which way it faces. */
  screen: { x: number; y: number; z: number; w: number; h: number };
  /** Good places for warm lights. */
  lights: Array<{ x: number; y: number; z: number }>;
}

export function buildInteriorGeometry(room: Interior): InteriorGeometry {
  const { w, h } = room;
  const lit = new GeoBuilder();
  const glow = new GeoBuilder();
  const tile = (x: number, y: number) => room.tiles[y * w + x];

  const floor = tileFloor(w, h, (tx, ty) => {
    const t = tile(tx, ty);
    if (t === I.RUG) return shade(RUG, (hash2(tx, ty) - 0.5) * 0.08);
    if (t === I.DOOR) return new THREE.Color(MAT);
    return shade((tx + ty) % 2 === 0 ? FLOOR_A : FLOOR_B, (hash2(tx * 3, ty * 5) - 0.5) * 0.08);
  });

  // Walls: the back wall is two tiles deep and tallest; the others are one tile and lower.
  const doorL = room.doorX;
  const doorR = room.doorX + 2;
  lit.span(0, w, 0, NORTH_WALL_HEIGHT, 0, 2, WALL);
  lit.span(0, w, NORTH_WALL_HEIGHT, NORTH_WALL_HEIGHT + 0.12, -0.1, 2.1, WALL_TOP);
  for (const [x0, x1] of [[0, 1], [w - 1, w]] as const) {
    lit.span(x0, x1, 0, SIDE_WALL_HEIGHT, 2, h, WALL);
    lit.span(x0 - (x0 === 0 ? 0.1 : 0), x1 + (x1 === w ? 0.1 : 0), SIDE_WALL_HEIGHT, SIDE_WALL_HEIGHT + 0.1, 2, h + 0.1, WALL_TOP);
  }
  for (const [x0, x1] of [[1, doorL], [doorR, w - 1]] as const) {
    lit.span(x0, x1, 0, SIDE_WALL_HEIGHT, h - 1, h, WALL);
    lit.span(x0, x1, SIDE_WALL_HEIGHT, SIDE_WALL_HEIGHT + 0.1, h - 1, h + 0.1, WALL_TOP);
  }
  // The doorway: a frame so it reads as a door from inside.
  lit.span(doorL - 0.1, doorL, 0, 2.4, h - 1, h, 0x5a4228);
  lit.span(doorR, doorR + 0.1, 0, 2.4, h - 1, h, 0x5a4228);
  // No lintel across the top: the camera looks in over the doorway, and a bar there would hide whoever stands in it.

  // Furniture, tile by tile.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const cx = tx + 0.5;
      const cz = ty + 0.5;
      switch (tile(tx, ty)) {
        case I.TABLE:
          lit.box(cx, 0.72, cz, 1.0, 0.1, 1.0, 0x9a7048);
          for (const [lx, lz] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) lit.box(tx + lx, 0, ty + lz, 0.1, 0.72, 0.1, 0x5b3b28);
          if (hash2(tx, ty) > 0.55) lit.cylinder(cx, 0.82, cz, 0.09, 0.07, 0.16, 0xd9a441, 6); // a mug
          break;
        case I.BAR:
          lit.box(cx, 0, cz, 1.0, 1.05, 0.9, 0x5b3b28);
          lit.box(cx, 1.05, cz, 1.04, 0.08, 0.96, 0x7a5236);
          glow.box(cx, 1.13, cz, 0.5, 0.05, 0.12, 0xd9a441);
          break;
        case I.BARREL:
          lit.cylinder(cx, 0, cz, 0.4, 0.45, 0.95, 0x6b4a36, 10);
          lit.cylinder(cx, 0.3, cz, 0.47, 0.47, 0.06, INK, 10);
          lit.cylinder(cx, 0.65, cz, 0.47, 0.47, 0.06, INK, 10);
          break;
        case I.SHELF:
          lit.box(cx, 0, cz, 0.9, 2.0, 0.9, 0x5b3b28);
          for (let s = 0; s < 3; s++) {
            const col = [0xa9573b, 0x5f7a5a, 0xd9a441, 0x4f6b86][(tx + ty + s) % 4];
            lit.box(cx, 0.4 + s * 0.55, cz, 0.7, 0.28, 0.94, col);
          }
          break;
      }
    }
  }

  // A hanging lamp over each end of the room, lit from within.
  const lights = [
    { x: w * 0.28, y: 2.6, z: h * 0.55 },
    { x: w * 0.72, y: 2.6, z: h * 0.55 },
  ];
  for (const l of lights) {
    glow.sphere(l.x, l.y, l.z, 0.18, GLOW, 8, 6);
    lit.cylinder(l.x, l.y + 0.1, l.z, 0.02, 0.02, 0.6, INK, 4);
  }

  const sx = room.screen.x + room.screen.w / 2;
  // Dark frame and shelf behind the screen; the screen itself is a separate mesh so its picture can change.
  lit.span(sx - SCREEN_W / 2 - 0.12, sx + SCREEN_W / 2 + 0.12, SCREEN_Y - 0.12, SCREEN_Y + SCREEN_H + 0.12, 1.94, 2.0, INK);

  return {
    floor,
    lit: lit.build(),
    glow: glow.build(),
    screen: { x: sx, y: SCREEN_Y + SCREEN_H / 2, z: 1.95, w: SCREEN_W, h: SCREEN_H },
    lights,
  };
}
