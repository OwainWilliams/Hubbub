import { describe, expect, it } from 'vitest';
import { CHUNK, ROAD, T, TILE, checksumChunk, generateChunk, isSolidTile } from './generate';
import { hashString, mix, mulberry32 } from './rng';
import { World } from './world';

const SEED = hashString('TEST-ROOM');

describe('rng', () => {
  it('hashes strings the same way every time', () => {
    expect(hashString('DAMP-LANTERN-42')).toBe(hashString('DAMP-LANTERN-42'));
    expect(hashString('A')).not.toBe(hashString('B'));
  });
  it('mix handles negative coordinates and is order sensitive', () => {
    expect(mix(1, -1, 2)).toBe(mix(1, -1, 2));
    expect(mix(1, 2, 3)).not.toBe(mix(1, 3, 2));
    expect(mix(1, -1, 0)).not.toBe(mix(1, 1, 0));
  });
  it('mulberry32 is deterministic and in range', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateChunk', () => {
  it('is deterministic', () => {
    for (const [cx, cy] of [[0, 0], [1, 0], [-3, 5], [7, -2]]) {
      expect(checksumChunk(generateChunk(SEED, cx, cy))).toBe(checksumChunk(generateChunk(SEED, cx, cy)));
    }
  });
  it('differs between seeds and between positions', () => {
    expect(checksumChunk(generateChunk(SEED, 2, 2))).not.toBe(checksumChunk(generateChunk(hashString('OTHER'), 2, 2)));
    expect(checksumChunk(generateChunk(SEED, 2, 2))).not.toBe(checksumChunk(generateChunk(SEED, 3, 2)));
  });
  it('matches the pinned fingerprints (fails if generation changes, which would split rooms across versions)', () => {
    const sums = [[0, 0], [1, 0], [2, 1], [-1, -1], [5, 3]].map(([cx, cy]) => checksumChunk(generateChunk(SEED, cx, cy)));
    expect(sums).toEqual([4099689865, 1975410876, 3111023953, 4132106326, 1316724060]);
  });
  it('always has a street along the top and left, and a plaza at the origin', () => {
    for (const [cx, cy] of [[0, 0], [4, 4], [-2, 3]]) {
      const c = generateChunk(SEED, cx, cy);
      for (let i = 0; i < CHUNK; i++) {
        expect(c.tiles[i]).toBe(T.STREET);
        expect(c.tiles[i * CHUNK]).toBe(T.STREET);
      }
    }
    expect(generateChunk(SEED, 0, 0).type).toBe('plaza');
  });
  it('has enterable buildings next to the spawn', () => {
    const c = generateChunk(SEED, 1, 0);
    expect(c.buildings.filter((b) => b.enterable).length).toBe(4);
  });
  it('puts every door on a door tile with open pavement in front of it', () => {
    const w = new World(SEED);
    for (let cx = -3; cx <= 3; cx++) {
      for (let cy = -3; cy <= 3; cy++) {
        for (const b of w.chunk(cx, cy).buildings) {
          if (!b.enterable) {
            expect(w.tileAt(b.doorX, b.doorY)).toBe(T.WALL);
            continue;
          }
          expect(w.tileAt(b.doorX, b.doorY)).toBe(T.DOOR);
          expect(w.tileAt(b.doorX + 1, b.doorY)).toBe(T.DOOR);
          expect(isSolidTile(w.tileAt(b.doorX, b.doorY + 1))).toBe(false);
          expect(isSolidTile(w.tileAt(b.doorX + 1, b.doorY + 1))).toBe(false);
          expect(w.doorAt((b.doorX + 0.5) * TILE, (b.doorY + 0.5) * TILE)?.id).toBe(b.id);
          expect(w.doorAt((b.doorX + 1.5) * TILE, (b.doorY + 0.5) * TILE)?.id).toBe(b.id);
          expect(w.buildingById(b.id)?.name).toBe(b.name);
        }
      }
    }
  });
});

describe('World', () => {
  it('lets you spawn on a free tile', () => {
    const w = new World(SEED);
    for (let i = 0; i < 100; i++) {
      const p = w.spawnPoint();
      expect(w.blocked(p.x, p.y, 12)).toBe(false);
    }
  });
  it('blocks walking into solid tiles and allows streets', () => {
    const w = new World(SEED);
    expect(w.blocked(2 * TILE, 2 * TILE, 12)).toBe(false); // street
    const b = w.chunk(1, 0).buildings[0];
    expect(w.blocked((b.x + 1) * TILE, (b.y + 1) * TILE, 12)).toBe(true); // inside a wall
  });
  it('keeps the whole town connected along its streets', () => {
    const w = new World(SEED);
    // Flood fill over walkable tiles in a 5 x 5 block of chunks, starting at the spawn.
    const span = 5 * CHUNK;
    const seen = new Set<number>();
    const start = { x: Math.floor(w.spawnPoint(() => 0.5).x / TILE), y: Math.floor(w.spawnPoint(() => 0.5).y / TILE) };
    const stack = [start];
    while (stack.length) {
      const { x, y } = stack.pop()!;
      if (x < 0 || y < 0 || x >= span || y >= span) continue;
      const k = y * span + x;
      if (seen.has(k)) continue;
      if (isSolidTile(w.tileAt(x, y))) continue;
      seen.add(k);
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }
    for (const [cx, cy] of [[4, 0], [0, 4], [4, 4], [2, 3]]) {
      expect(seen.has((cy * CHUNK + 1) * span + (cx * CHUNK + 1)), `street corner of chunk ${cx},${cy}`).toBe(true);
    }
    expect(ROAD).toBe(4);
  });
  it('caches chunks without growing forever', () => {
    const w = new World(SEED);
    for (let i = 0; i < 300; i++) w.chunk(i, 0);
    expect(w.chunk(299, 0).cx).toBe(299);
  });
});
