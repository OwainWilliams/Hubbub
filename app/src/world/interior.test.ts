import { describe, expect, it } from 'vitest';
import type { Building } from './generate';
import { I, generateInterior, interiorBlocked, interiorTile, isSolidInterior } from './interior';
import { hashString } from './rng';
import { World } from './world';

const SEED = hashString('TEST-ROOM');

function allEnterable(): Building[] {
  const w = new World(SEED);
  const out: Building[] = [];
  for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) out.push(...w.chunk(cx, cy).buildings.filter((b) => b.enterable));
  return out;
}

describe('generateInterior', () => {
  const buildings = allEnterable();

  it('has buildings of every enterable kind to test with', () => {
    expect(new Set(buildings.map((b) => b.kind))).toEqual(new Set(['tavern', 'hall', 'shop']));
  });

  it('is deterministic', () => {
    for (const b of buildings.slice(0, 20)) {
      expect([...generateInterior(SEED, b).tiles]).toEqual([...generateInterior(SEED, b).tiles]);
    }
  });

  it('has a door in the bottom wall, a screen in the top wall, and a free spawn tile', () => {
    for (const b of buildings) {
      const i = generateInterior(SEED, b);
      expect(interiorTile(i, i.doorX, i.doorY)).toBe(I.DOOR);
      expect(interiorTile(i, i.doorX + 1, i.doorY)).toBe(I.DOOR);
      expect(i.doorY).toBe(i.h - 1);
      for (let x = i.screen.x; x < i.screen.x + i.screen.w; x++) expect(interiorTile(i, x, 1)).toBe(I.SCREEN);
      expect(interiorBlocked(i, i.spawn.x, i.spawn.y, 12, 32)).toBe(false);
      expect(interiorBlocked(i, i.spawn.x - 12, i.spawn.y, 12, 32)).toBe(false); // scatter on entry stays clear
    }
  });

  it('lets you walk from the door to the space in front of the screen', () => {
    for (const b of buildings) {
      const i = generateInterior(SEED, b);
      const seen = new Set<number>();
      const stack = [{ x: Math.floor(i.spawn.x / 32), y: Math.floor(i.spawn.y / 32) }];
      while (stack.length) {
        const { x, y } = stack.pop()!;
        const k = y * i.w + x;
        if (seen.has(k) || isSolidInterior(interiorTile(i, x, y))) continue;
        seen.add(k);
        stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
      }
      const front = { x: i.screen.x + 2, y: 3 };
      expect(seen.has(front.y * i.w + front.x), `${b.kind} ${b.id}`).toBe(true);
    }
  });
});
