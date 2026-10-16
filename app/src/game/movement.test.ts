import { describe, expect, it } from 'vitest';
import { SPEED, smoothToward, stepPosition } from './movement';

describe('stepPosition', () => {
  it('moves at SPEED in a straight line', () => {
    expect(stepPosition(500, 500, 1, 0, 1)).toEqual({ x: 500 + SPEED, y: 500 });
  });
  it('does not move faster on diagonals', () => {
    const p = stepPosition(500, 500, 1, 1, 1);
    expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(SPEED);
  });
  it('stands still with no input', () => {
    expect(stepPosition(10, 20, 0, 0, 1)).toEqual({ x: 10, y: 20 });
  });
  it('is stopped by a wall', () => {
    const wall = (x: number) => x >= 600;
    expect(stepPosition(590, 100, 1, 0, 1, (x) => wall(x))).toEqual({ x: 590, y: 100 });
  });
  it('slides along a wall when moving diagonally into it', () => {
    const wall = (x: number) => x >= 600;
    const p = stepPosition(590, 100, 1, 1, 0.1, (x) => wall(x));
    expect(p.x).toBe(590);
    expect(p.y).toBeGreaterThan(100);
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
