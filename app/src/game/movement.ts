export const WORLD = { width: 2400, height: 1800 };
export const PLAYER_RADIUS = 16;
export const SPEED = 200; // pixels per second

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Moves one step in direction (dx, dy), where each is -1, 0 or 1. Diagonals are normalised so they are not faster. */
export function stepPosition(x: number, y: number, dx: number, dy: number, dtSec: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
  }
  return {
    x: clamp(x + dx * SPEED * dtSec, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS),
    y: clamp(y + dy * SPEED * dtSec, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS),
  };
}

/** Frame-rate independent easing of `current` towards `target`. */
export function smoothToward(current: number, target: number, dtSec: number, rate = 14): number {
  return current + (target - current) * (1 - Math.exp(-rate * dtSec));
}
