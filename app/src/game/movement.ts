export const PLAYER_RADIUS = 16; // size of the drawn avatar
export const COLLIDE_RADIUS = 12; // a little smaller, so corners are forgiving
export const SPEED = 200; // pixels per second

/** Returns true if a body centred here would overlap something solid. */
export type Blocked = (x: number, y: number) => boolean;

const open: Blocked = () => false;

/**
 * Moves one step in direction (dx, dy), where each is -1, 0 or 1. Diagonals are normalised so they are not
 * faster. Each axis is tried on its own so you slide along walls instead of sticking to them.
 */
export function stepPosition(x: number, y: number, dx: number, dy: number, dtSec: number, blocked: Blocked = open): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
  }
  const nx = x + dx * SPEED * dtSec;
  const fx = blocked(nx, y) ? x : nx;
  const ny = y + dy * SPEED * dtSec;
  const fy = blocked(fx, ny) ? y : ny;
  return { x: fx, y: fy };
}

/** Frame-rate independent easing of `current` towards `target`. */
export function smoothToward(current: number, target: number, dtSec: number, rate = 14): number {
  return current + (target - current) * (1 - Math.exp(-rate * dtSec));
}
