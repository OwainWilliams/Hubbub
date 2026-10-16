// Camera maths for the 3D view, kept free of three.js objects so it can be unit tested.
//
// World axes: x is east, z is south (the same as the 2D map's x and y), y is up. The camera orbits a target
// point. At yaw 0 it sits to the south of the target looking north, so "up the screen" matches the 2D view.

export interface Orbit {
  /** Radians. 0 = camera south of the target looking north; positive swings it round towards the east. */
  yaw: number;
  /** Radians above the ground, 0 (level) to PI/2 (straight down). */
  pitch: number;
  /** Distance from the target in world units. */
  distance: number;
}

export interface Limits {
  minPitch: number;
  maxPitch: number;
  minDistance: number;
  maxDistance: number;
}

export const OUTDOOR: Limits = { minPitch: 0.5, maxPitch: 1.3, minDistance: 6, maxDistance: 28 };
/** Where the camera starts. */
export const OUTDOOR_START: Orbit = { yaw: 0, pitch: 0.85, distance: 14 };
export const INDOOR_START: Orbit = { yaw: 0, pitch: 1.0, distance: 12 };
/** Indoors the camera stays high enough to look over the walls. */
export const INDOOR: Limits = { minPitch: 0.95, maxPitch: 1.35, minDistance: 6, maxDistance: 15 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampOrbit(o: Orbit, l: Limits): Orbit {
  return { yaw: o.yaw, pitch: clamp(o.pitch, l.minPitch, l.maxPitch), distance: clamp(o.distance, l.minDistance, l.maxDistance) };
}

/** Where the camera sits relative to its target. */
export function cameraOffset(o: Orbit): { x: number; y: number; z: number } {
  const horizontal = Math.cos(o.pitch) * o.distance;
  return { x: Math.sin(o.yaw) * horizontal, y: Math.sin(o.pitch) * o.distance, z: Math.cos(o.yaw) * horizontal };
}

/**
 * Turns "right" and "forward" (each -1, 0 or 1) into a direction on the ground, so forward always means away
 * from the camera. At yaw 0 this is (strafe, -forward): right is east, forward is north.
 */
export function inputToGround(strafe: number, forward: number, yaw: number): { dx: number; dy: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { dx: strafe * c - forward * s, dy: -strafe * s - forward * c };
}

/** The angle (radians) an avatar should face to look along ground direction (dx, dz). 0 faces south (+z). */
export function headingFor(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Smoothly turns `current` towards `target` the short way round. */
export function turnToward(current: number, target: number, dtSec: number, rate = 14): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-rate * dtSec));
}
