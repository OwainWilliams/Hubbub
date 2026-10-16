import { CHUNK, TILE, T, generateChunk, isSolidTile, type Building, type Chunk } from './generate';

const MAX_CACHED = 80;

/** The whole (endless) town, generated on demand from one seed. */
export class World {
  private readonly cache = new Map<string, Chunk>();

  constructor(readonly seed: number) {}

  chunk(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`;
    let c = this.cache.get(key);
    if (c) {
      // Re-insert so the least recently used chunk is always first in the map.
      this.cache.delete(key);
    } else {
      c = generateChunk(this.seed, cx, cy);
      if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(key, c);
    return c;
  }

  tileAt(tx: number, ty: number): number {
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const lx = tx - cx * CHUNK;
    const ly = ty - cy * CHUNK;
    return this.chunk(cx, cy).tiles[ly * CHUNK + lx];
  }

  /** True if a circle-ish body centred at pixel (px, py) with the given radius overlaps a solid tile. */
  blocked(px: number, py: number, radius: number): boolean {
    for (const [dx, dy] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
      if (isSolidTile(this.tileAt(Math.floor((px + dx) / TILE), Math.floor((py + dy) / TILE)))) return true;
    }
    return false;
  }

  /** The enterable building whose door is at this pixel position, if any. */
  doorAt(px: number, py: number): Building | undefined {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (this.tileAt(tx, ty) !== T.DOOR) return undefined;
    const c = this.chunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    return c.buildings.find((b) => b.enterable && b.doorY === ty && (tx === b.doorX || tx === b.doorX + 1));
  }

  buildingById(id: string): Building | undefined {
    const [cx, cy] = id.split(':').map(Number);
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) return undefined;
    return this.chunk(cx, cy).buildings.find((b) => b.id === id);
  }

  /** A free spot in the starting plaza. `rand` lets each person land in a slightly different place. */
  spawnPoint(rand: () => number = Math.random): { x: number; y: number } {
    for (let i = 0; i < 50; i++) {
      const x = (9 + (rand() - 0.5) * 4) * TILE;
      const y = (9 + (rand() - 0.5) * 4) * TILE;
      if (!this.blocked(x, y, 12)) return { x, y };
    }
    return { x: 9.5 * TILE, y: 9.5 * TILE };
  }
}
