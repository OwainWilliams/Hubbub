import type { Building, BuildingKind } from './generate';
import { mix, mulberry32 } from './rng';

export const I = {
  FLOOR: 0,
  RUG: 1,
  // Solid from here up, except DOOR.
  WALL: 20,
  DOOR: 21,
  TABLE: 22,
  BAR: 23,
  BARREL: 24,
  SHELF: 25,
  SCREEN: 26,
} as const;

export function isSolidInterior(t: number): boolean {
  return t >= I.WALL && t !== I.DOOR;
}

const TILE_PX = 32; // must match TILE in generate.ts

const SIZES: Record<BuildingKind, [number, number]> = {
  tavern: [18, 12],
  hall: [20, 12],
  shop: [14, 10],
  house: [10, 8],
};

export interface Interior {
  id: string;
  name: string;
  kind: BuildingKind;
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Left tile of the two-tile-wide exit door (bottom wall) and its row. */
  doorX: number;
  doorY: number;
  /** Where you land after walking in: just inside the middle of the door, in room pixels. */
  spawn: { x: number; y: number };
  /** The wall screen, in tiles. Anyone in the room can share to it. */
  screen: { x: number; y: number; w: number; h: number };
}

/** Builds the inside of an enterable building. Pure, like generateChunk: same seed and building, same room. */
export function generateInterior(seed: number, b: Building): Interior {
  const rnd = mulberry32(mix(seed, b.x, b.y, 0xb1));
  const [w, h] = SIZES[b.kind];
  const tiles = new Uint8Array(w * h);
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t;
  };
  const fill = (x0: number, y0: number, fw: number, fh: number, t: number) => {
    for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) set(x, y, t);
  };

  fill(0, 0, w, 2, I.WALL);
  fill(0, h - 1, w, 1, I.WALL);
  fill(0, 0, 1, h, I.WALL);
  fill(w - 1, 0, 1, h, I.WALL);

  const doorX = Math.floor(w / 2) - 1;
  const doorY = h - 1;
  set(doorX, doorY, I.DOOR);
  set(doorX + 1, doorY, I.DOOR);

  const sx = doorX - 1;
  const screen = { x: sx, y: 0, w: 4, h: 2 };
  fill(screen.x, screen.y, screen.w, screen.h, I.SCREEN);

  // Areas that must stay walkable: the lane from the door to the room, and the space in front of the screen.
  const lane = { x: doorX - 1, y: 2, w: 4, h: h - 3 };
  const viewing = { x: sx - 1, y: 2, w: 6, h: 4 };
  const overlaps = (a: { x: number; y: number; w: number; h: number }, x: number, y: number, rw: number, rh: number) =>
    x < a.x + a.w && x + rw > a.x && y < a.y + a.h && y + rh > a.y;
  const free = (x: number, y: number, rw: number, rh: number) =>
    !overlaps(lane, x, y, rw, rh) && !overlaps(viewing, x, y, rw, rh) && x >= 1 && y >= 2 && x + rw <= w - 1 && y + rh <= h - 1;

  fill(doorX - 2, 6, 6, 3, I.RUG);

  if (b.kind === 'tavern') {
    fill(2, 3, 4, 1, I.BAR);
    for (const [x, y] of [[1, 2], [w - 2, 2], [1, h - 2], [w - 2, h - 2]]) set(x, y, I.BARREL);
    for (const x of [3, 7, 11, 14]) {
      for (const y of [6, 9]) if (free(x, y, 2, 2) && rnd() < 0.7) fill(x, y, 2, 2, I.TABLE);
    }
  } else if (b.kind === 'hall') {
    for (const x of [3, w - 7]) {
      for (const y of [6, 9]) if (free(x, y, 4, 2)) fill(x, y, 4, 2, I.TABLE);
    }
  } else {
    fill(1, 3, 1, h - 5, I.SHELF);
    fill(w - 2, 3, 1, h - 5, I.SHELF);
    if (free(3, 6, 5, 1)) fill(3, 6, 5, 1, I.BAR);
  }

  return { id: b.id, name: b.name, kind: b.kind, w, h, tiles, doorX, doorY, spawn: { x: (doorX + 1) * TILE_PX, y: (h - 1) * TILE_PX - TILE_PX / 2 }, screen };
}

export function interiorTile(i: Interior, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= i.w || ty >= i.h) return I.WALL;
  return i.tiles[ty * i.w + tx];
}

export function interiorBlocked(i: Interior, px: number, py: number, radius: number, tile: number): boolean {
  for (const [dx, dy] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
    if (isSolidInterior(interiorTile(i, Math.floor((px + dx) / tile), Math.floor((py + dy) / tile)))) return true;
  }
  return false;
}
