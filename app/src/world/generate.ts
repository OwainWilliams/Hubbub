import { buildingName } from './names';
import { mix, mulberry32 } from './rng';

export const CHUNK = 32; // tiles per chunk side
export const TILE = 32; // pixels per tile
export const ROAD = 4; // width of the street along the top and left of every chunk

export const T = {
  GRASS: 0,
  STREET: 1,
  PLAZA: 2,
  PATH: 3,
  // Solid from here up, except DOOR.
  WALL: 10,
  DOOR: 11,
  TREE: 12,
  STALL: 13,
  FOUNTAIN: 14,
  LAMP: 15,
  BENCH: 16,
} as const;

export function isSolidTile(t: number): boolean {
  return t >= T.WALL && t !== T.DOOR;
}

export type ChunkType = 'houses' | 'market' | 'park' | 'plaza';
export type BuildingKind = 'tavern' | 'hall' | 'shop' | 'house';

export interface Building {
  /** Stable id, same for everyone: "cx:cy:lot". */
  id: string;
  kind: BuildingKind;
  name: string;
  /** Houses are scenery. The others have a door and an interior. */
  enterable: boolean;
  /** World tile coordinates of the footprint. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Left tile of the two-tile-wide door (the door covers doorX and doorX + 1) and its row. */
  doorX: number;
  doorY: number;
  /** Colour choice for the art (index into the pack's palette). */
  style: number;
}

export interface Chunk {
  cx: number;
  cy: number;
  type: ChunkType;
  tiles: Uint8Array;
  buildings: Building[];
}

export function chunkType(seed: number, cx: number, cy: number): ChunkType {
  if (cx === 0 && cy === 0) return 'plaza'; // everyone spawns in the plaza
  if (cx === 1 && cy === 0) return 'houses'; // and there is always somewhere to go in next door
  const r = mulberry32(mix(seed, cx, cy, 0xc1))();
  if (r < 0.55) return 'houses';
  if (r < 0.7) return 'market';
  if (r < 0.85) return 'park';
  return 'plaza';
}

/**
 * Builds one square of the town from the world seed and the square's position. Pure: the same inputs always
 * give the same chunk, which is how everyone in a room sees the same town without any map being sent.
 */
export function generateChunk(seed: number, cx: number, cy: number): Chunk {
  const rnd = mulberry32(mix(seed, cx, cy, 0xc2));
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const tiles = new Uint8Array(CHUNK * CHUNK);
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && y >= 0 && x < CHUNK && y < CHUNK) tiles[y * CHUNK + x] = t;
  };
  const get = (x: number, y: number) => tiles[y * CHUNK + x];
  const fill = (x0: number, y0: number, w: number, h: number, t: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t);
  };

  const type = chunkType(seed, cx, cy);
  const buildings: Building[] = [];
  const inner = CHUNK - ROAD;

  if (type === 'plaza' || type === 'market') fill(ROAD, ROAD, inner, inner, T.PLAZA);

  if (type === 'plaza') {
    fill(14, 14, 4, 4, T.FOUNTAIN);
    for (const [x, y] of [[12, 12], [19, 12], [12, 19], [19, 19]]) set(x, y, T.BENCH);
    for (const [x, y] of [[5, 5], [30, 5], [5, 30], [30, 30]]) set(x, y, T.LAMP);
  } else if (type === 'market') {
    for (const y of [8, 16, 24]) {
      for (let x = 6; x <= 26; x += 7) if (rnd() < 0.75) fill(x, y, 3, 2, T.STALL);
    }
    for (const [x, y] of [[5, 5], [30, 5], [5, 30], [30, 30]]) set(x, y, T.LAMP);
  } else if (type === 'park') {
    fill(ROAD, 17, inner, 2, T.PATH);
    fill(17, ROAD, 2, inner, T.PATH);
    for (let y = 6; y < CHUNK - 1; y++) {
      for (let x = 6; x < CHUNK - 1; x++) {
        if (get(x, y) === T.GRASS && rnd() < 0.07) set(x, y, T.TREE);
      }
    }
  } else {
    // Four lots, each 14 x 14 tiles, with a pavement along the bottom edge.
    const forced = cx === 1 && cy === 0;
    let lot = 0;
    for (const ly of [ROAD, ROAD + 14]) {
      for (const lx of [ROAD, ROAD + 14]) {
        const id = `${cx}:${cy}:${lot++}`;
        fill(lx, ly + 13, 14, 1, T.PATH);
        if (!forced && rnd() < 0.12) {
          for (let i = 0; i < 4; i++) set(lx + int(1, 12), ly + int(1, 10), T.TREE); // an empty yard
          continue;
        }
        const w = int(7, 11);
        const h = int(5, 7);
        const x0 = lx + Math.floor((13 - w) / 2);
        const y0 = ly + 13 - h;
        const enterable = forced || rnd() < 0.6;
        const k = rnd();
        const kind: BuildingKind = !enterable ? 'house' : k < 0.4 ? 'tavern' : k < 0.7 ? 'hall' : 'shop';
        fill(x0, y0, w, h, T.WALL);
        const doorX = x0 + Math.floor(w / 2) - 1;
        const doorY = y0 + h - 1;
        if (enterable) {
          set(doorX, doorY, T.DOOR);
          set(doorX + 1, doorY, T.DOOR);
        }
        set(lx + 1, ly + 13, T.LAMP);
        buildings.push({
          id,
          kind,
          name: buildingName(rnd),
          enterable,
          x: cx * CHUNK + x0,
          y: cy * CHUNK + y0,
          w,
          h,
          doorX: cx * CHUNK + doorX,
          doorY: cy * CHUNK + doorY,
          style: int(0, 3),
        });
      }
    }
  }

  fill(0, 0, CHUNK, ROAD, T.STREET);
  fill(0, 0, ROAD, CHUNK, T.STREET);
  return { cx, cy, type, tiles, buildings };
}

/** Cheap fingerprint of a chunk, used by tests to prove two machines generated the same thing. */
export function checksumChunk(c: Chunk): number {
  let h = 0x811c9dc5;
  for (const t of c.tiles) {
    h ^= t;
    h = Math.imul(h, 0x01000193);
  }
  for (const b of c.buildings) {
    h ^= (b.x * 31 + b.y * 17 + b.w * 7 + b.h + (b.enterable ? 1 : 0) + b.style) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
