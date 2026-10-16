// The rules for who hears whom. Kept free of browser APIs so they can be unit tested.

/** Inside this distance (pixels) you hear someone at full volume. */
export const FULL_RANGE = 110;
/** Beyond this distance you do not hear them at all, outdoors. */
export const HEAR_RANGE = 360;
/** Once audio is flowing, it only stops when they are this much further than HEAR_RANGE, so it does not flicker at the edge. */
export const HYSTERESIS = 1.15;

/** Volume from 0 to 1 for someone `distance` pixels away outdoors. */
export function volumeFor(distance: number): number {
  if (distance <= FULL_RANGE) return 1;
  if (distance >= HEAR_RANGE) return 0;
  const t = (distance - FULL_RANGE) / (HEAR_RANGE - FULL_RANGE);
  return (1 - t) * (1 - t);
}

export interface Hearing {
  /** True when they are in the same place as us (both outdoors, or inside the same building). */
  samePlace: boolean;
  /** True when that place is a building: everyone in the room hears everyone, at any distance. */
  indoors: boolean;
  distance: number;
  /** Whether audio was already being sent or received for this pair. */
  wasAudible: boolean;
}

/** Whether audio should flow between us and them right now. */
export function shouldHear(h: Hearing): boolean {
  if (!h.samePlace) return false;
  if (h.indoors) return true;
  return h.distance <= (h.wasAudible ? HEAR_RANGE * HYSTERESIS : HEAR_RANGE);
}

/** The volume to play someone at. */
export function gainFor(h: Pick<Hearing, 'samePlace' | 'indoors' | 'distance'>): number {
  if (!h.samePlace) return 0;
  return h.indoors ? 1 : volumeFor(h.distance);
}

/** Pan from -1 (left) to 1 (right) so people sound like they are on the side they are standing. */
export function panFor(dx: number, distance: number): number {
  if (distance < 1) return 0;
  return Math.max(-1, Math.min(1, (dx / Math.max(distance, FULL_RANGE)) * 0.8));
}
