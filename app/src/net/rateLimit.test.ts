import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit';

describe('RateLimiter', () => {
  it('allows a burst up to capacity and then refuses', () => {
    const r = new RateLimiter(5, 1, 0);
    expect([1, 2, 3, 4, 5, 6, 7].map(() => r.allow(0))).toEqual([true, true, true, true, true, false, false]);
  });
  it('refills over time at the given rate', () => {
    const r = new RateLimiter(2, 10, 0);
    r.allow(0);
    r.allow(0);
    expect(r.allow(0)).toBe(false);
    expect(r.allow(100)).toBe(true); // 0.1s at 10/s is one token
    expect(r.allow(100)).toBe(false);
  });
  it('never holds more than its capacity however long it idles', () => {
    const r = new RateLimiter(3, 100, 0);
    const results = Array.from({ length: 6 }, () => r.allow(60_000));
    expect(results).toEqual([true, true, true, false, false, false]);
  });
  it('never refuses normal traffic, and refuses sustained flooding', () => {
    // The limits peers use: about 15 position updates a second is normal movement, 40 a second is the ceiling.
    const normal = new RateLimiter(60, 40, 0);
    let refusedNormal = 0;
    for (let i = 0; i < 600; i++) if (!normal.allow(i * 66)) refusedNormal++;
    expect(refusedNormal).toBe(0);

    const flood = new RateLimiter(60, 40, 0);
    let allowed = 0;
    for (let i = 0; i < 6000; i++) if (flood.allow(i)) allowed++; // 1000 a second for six seconds
    expect(allowed).toBeLessThan(60 + 40 * 6 + 5);
  });
});
