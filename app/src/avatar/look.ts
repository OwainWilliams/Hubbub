/**
 * What an avatar looks like, as a handful of small numbers. Everything about how it is drawn lives in svg.ts,
 * so the placeholder art can be replaced (for example by layered LPC sprites) without touching the network
 * or game code: keep this file's `Look` and the functions below.
 */

export interface Look {
  kind: number;
  hat: number;
  robe: number;
  skin: number;
  extra: number;
}

export const KIND_NAMES = ['Human', 'Dwarf', 'Troll'];
export const HAT_NAMES = ['Pointy hat', 'Bowler', 'Helm', 'None'];
export const ROBE_NAMES = ['Ochre', 'Moss', 'Brick', 'Plum', 'Slate'];
export const ROBE_COLORS = ['#d9a441', '#5f7a5a', '#a9573b', '#6d4a73', '#4f6b86'];
export const SKIN_NAMES = ['Fair', 'Tan', 'Deep', 'Grey'];
export const SKIN_COLORS = ['#e9c7a3', '#c99466', '#7d5236', '#8d9a94'];
export const EXTRA_NAMES = ['None', 'Beard', 'Spectacles'];

const LIMITS: Record<keyof Look, number> = {
  kind: KIND_NAMES.length,
  hat: HAT_NAMES.length,
  robe: ROBE_NAMES.length,
  skin: SKIN_NAMES.length,
  extra: EXTRA_NAMES.length,
};

export function defaultLook(): Look {
  return { kind: 0, hat: 0, robe: 0, skin: 0, extra: 0 };
}

export function randomLook(rand: () => number = Math.random): Look {
  const pick = (n: number) => Math.floor(rand() * n);
  return { kind: pick(LIMITS.kind), hat: pick(LIMITS.hat), robe: pick(LIMITS.robe), skin: pick(LIMITS.skin), extra: pick(LIMITS.extra) };
}

/** Anything unexpected falls back to the default, so a bad value can never break drawing. */
export function parseLook(v: unknown): Look {
  const d = defaultLook();
  if (typeof v !== 'object' || v === null) return d;
  const o = v as Record<string, unknown>;
  const field = (k: keyof Look) => (Number.isInteger(o[k]) && (o[k] as number) >= 0 && (o[k] as number) < LIMITS[k] ? (o[k] as number) : d[k]);
  return { kind: field('kind'), hat: field('hat'), robe: field('robe'), skin: field('skin'), extra: field('extra') };
}

/** Compact form sent over the network: five small numbers. */
export function lookToWire(l: Look): number[] {
  return [l.kind, l.hat, l.robe, l.skin, l.extra];
}

export function lookFromWire(v: unknown): Look | null {
  if (!Array.isArray(v) || v.length !== 5 || !v.every((n) => Number.isInteger(n) && n >= 0 && n <= 9)) return null;
  return parseLook({ kind: v[0], hat: v[1], robe: v[2], skin: v[3], extra: v[4] });
}

/** The colour used for the roster dot and as a fallback. */
export function lookColor(l: Look): string {
  return ROBE_COLORS[l.robe];
}

export function lookKey(l: Look): string {
  return `${l.kind}${l.hat}${l.robe}${l.skin}${l.extra}`;
}

export function lookLimits(): Record<keyof Look, number> {
  return { ...LIMITS };
}
