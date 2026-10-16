// Integer-only hashing and random numbers. The world must come out identical on every machine, so nothing
// here uses floating point except the final division by 2^32 (exact in IEEE doubles).

/** FNV-1a hash of a string to an unsigned 32-bit number. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combines integers (such as a world seed and chunk coordinates) into one well-mixed unsigned 32-bit number. */
export function mix(a: number, b: number, c = 0, d = 0): number {
  let h = a | 0;
  for (const v of [b, c, d]) {
    h ^= v | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Small fast seeded random generator returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
