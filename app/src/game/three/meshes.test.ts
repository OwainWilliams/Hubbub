import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { CHUNK, type Building } from '../../world/generate';
import { generateInterior } from '../../world/interior';
import { hashString } from '../../world/rng';
import { World } from '../../world/world';
import { buildChunkGeometry, ROOF_RISE, WALL_HEIGHT } from './chunkMesh';
import { buildInteriorGeometry, SCREEN_H, SCREEN_W } from './interiorMesh';

const SEED = hashString('TEST-ROOM');

function allFinite(g: THREE.BufferGeometry | null): boolean {
  if (!g) return true;
  for (const name of ['position', 'color'] as const) {
    const a = g.getAttribute(name);
    if (!a) return false;
    for (const v of a.array) if (!Number.isFinite(v)) return false;
  }
  return true;
}

function bounds(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe('buildChunkGeometry', () => {
  const world = new World(SEED);

  it('builds finite geometry for every kind of square', () => {
    const seen = new Set<string>();
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = -4; cy <= 4; cy++) {
        const chunk = world.chunk(cx, cy);
        seen.add(chunk.type);
        const g = buildChunkGeometry(chunk);
        for (const part of [g.ground, g.lit, g.glow, g.halo]) expect(allFinite(part), `${chunk.type} ${cx},${cy}`).toBe(true);
      }
    }
    expect(seen).toEqual(new Set(['houses', 'market', 'park', 'plaza']));
  });

  it('keeps the ground exactly one square wide and flat', () => {
    const b = bounds(buildChunkGeometry(world.chunk(0, 0)).ground);
    expect([b.min.x, b.max.x, b.min.z, b.max.z]).toEqual([0, CHUNK, 0, CHUNK]);
    expect(b.min.y).toBe(0);
    expect(b.max.y).toBe(0);
  });

  it('gives each square a few big meshes, not hundreds of little ones', () => {
    // Everything for a square is merged into at most four geometries.
    const g = buildChunkGeometry(world.chunk(1, 0));
    expect([g.ground, g.lit, g.glow, g.halo].filter(Boolean).length).toBeLessThanOrEqual(4);
  });

  it('keeps buildings and props inside their square (roof overhang aside)', () => {
    for (const [cx, cy] of [[1, 0], [2, 1], [-1, -1]]) {
      const g = buildChunkGeometry(world.chunk(cx, cy));
      const b = bounds(g.lit!);
      expect(b.min.x).toBeGreaterThan(-1);
      expect(b.max.x).toBeLessThan(CHUNK + 1);
      expect(b.min.z).toBeGreaterThan(-1);
      expect(b.max.z).toBeLessThan(CHUNK + 1);
      expect(b.min.y).toBeGreaterThan(-1e-4); // not below the ground, allowing for rounding
      expect(b.max.y).toBeLessThan(WALL_HEIGHT + 0.6 + ROOF_RISE + 2.5);
    }
  });

  it('puts a sign on every enterable building and none on houses', () => {
    for (const [cx, cy] of [[1, 0], [2, 0], [1, 1], [3, 2]]) {
      const chunk = world.chunk(cx, cy);
      const g = buildChunkGeometry(chunk);
      expect(g.signs.map((s) => s.text).sort()).toEqual(chunk.buildings.filter((b) => b.enterable).map((b) => b.name).sort());
    }
  });

  it('is deterministic', () => {
    const a = buildChunkGeometry(world.chunk(2, 2));
    const b = buildChunkGeometry(world.chunk(2, 2));
    expect([...a.lit!.getAttribute('position').array]).toEqual([...b.lit!.getAttribute('position').array]);
  });
});

describe('buildInteriorGeometry', () => {
  const world = new World(SEED);
  const buildings: Building[] = [];
  for (let cx = -2; cx <= 3; cx++) for (let cy = -2; cy <= 3; cy++) buildings.push(...world.chunk(cx, cy).buildings.filter((b) => b.enterable));

  it('builds finite geometry for every room, in room coordinates', () => {
    expect(buildings.length).toBeGreaterThan(10);
    for (const b of buildings) {
      const room = generateInterior(SEED, b);
      const g = buildInteriorGeometry(room);
      for (const part of [g.floor, g.lit, g.glow]) expect(allFinite(part), `${b.kind} ${b.id}`).toBe(true);
      const f = bounds(g.floor);
      expect([f.min.x, f.max.x, f.min.z, f.max.z]).toEqual([0, room.w, 0, room.h]);
    }
  });

  it('puts the screen on the back wall, inside the room and above the floor', () => {
    for (const b of buildings.slice(0, 12)) {
      const room = generateInterior(SEED, b);
      const { screen } = buildInteriorGeometry(room);
      expect(screen.x - screen.w / 2).toBeGreaterThanOrEqual(0);
      expect(screen.x + screen.w / 2).toBeLessThanOrEqual(room.w);
      expect(screen.z).toBeLessThan(2.1);
      expect(screen.y - screen.h / 2).toBeGreaterThan(0.5);
      expect(screen.w).toBe(SCREEN_W);
      expect(screen.h).toBe(SCREEN_H);
    }
  });

  it('keeps the walls low enough to look over from the indoor camera', () => {
    for (const b of buildings.slice(0, 6)) {
      const g = buildInteriorGeometry(generateInterior(SEED, b));
      expect(bounds(g.lit!).max.y).toBeLessThan(3.6);
    }
  });
});
