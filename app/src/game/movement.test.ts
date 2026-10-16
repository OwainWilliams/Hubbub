import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, SPEED, WORLD, smoothToward, stepPosition } from './movement';

describe('stepPosition', () => {
  it('moves at SPEED in a straight line', () => {
    expect(stepPosition(500, 500, 1, 0, 1)).toEqual({ x: 500 + SPEED, y: 500 });
  });
  it('does not move faster on diagonals', () => {
    const p = stepPosition(500, 500, 1, 1, 1);
    expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(SPEED);
  });
  it('stays inside the world', () => {
    expect(stepPosition(PLAYER_RADIUS, PLAYER_RADIUS, -1, -1, 10)).toEqual({ x: PLAYER_RADIUS, y: PLAYER_RADIUS });
    const far = stepPosition(WORLD.width, WORLD.height, 1, 1, 10);
    expect(far).toEqual({ x: WORLD.width - PLAYER_RADIUS, y: WORLD.height - PLAYER_RADIUS });
  });
  it('stands still with no input', () => {
    expect(stepPosition(10 + PLAYER_RADIUS, 20 + PLAYER_RADIUS, 0, 0, 1)).toEqual({ x: 10 + PLAYER_RADIUS, y: 20 + PLAYER_RADIUS });
  });
});

describe('smoothToward', () => {
  it('approaches the target without overshooting', () => {
    let v = 0;
    for (let i = 0; i < 120; i++) {
      v = smoothToward(v, 100, 1 / 60);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(v).toBeGreaterThan(99);
  });
  it('gives the same result regardless of frame rate', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = smoothToward(a, 100, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = smoothToward(b, 100, 1 / 30);
    expect(a).toBeCloseTo(b, 5);
  });
});
