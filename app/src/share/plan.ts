// How a screen share is split between viewers. A shared screen is sent once per viewer, so the sharer's
// upload is the limit: more viewers means each one gets less. Pure functions so they can be unit tested.

/** At most this many people can watch one screen. */
export const MAX_VIEWERS = 6;
/** Rough upload budget for one share, in bits per second. */
export const UPLOAD_BUDGET = 3_000_000;
const MIN_BITRATE = 300_000;
const MAX_BITRATE = 2_500_000;

export interface VideoPlan {
  /** Bits per second for each viewer. */
  bitrate: number;
  /** 1 means full size, 2 means half width and height. */
  scaleDownBy: number;
}

/** Quality for each viewer given how many are watching. */
export function planVideo(viewers: number): VideoPlan {
  const n = Math.max(1, viewers);
  const bitrate = Math.max(MIN_BITRATE, Math.min(MAX_BITRATE, Math.floor(UPLOAD_BUDGET / n)));
  const scaleDownBy = n <= 2 ? 1 : n <= 4 ? 1.5 : 2;
  return { bitrate, scaleDownBy };
}

/** Splits the people in the room into those who get the picture and those who are over the limit. Stable by id. */
export function pickViewers(ids: string[], max = MAX_VIEWERS, current: ReadonlySet<string> = new Set()): { watching: string[]; full: string[] } {
  // People already watching keep their place, so a newcomer cannot bump anyone.
  const keep = ids.filter((id) => current.has(id)).sort();
  const rest = ids.filter((id) => !current.has(id)).sort();
  const ordered = [...keep, ...rest];
  return { watching: ordered.slice(0, max), full: ordered.slice(max) };
}
