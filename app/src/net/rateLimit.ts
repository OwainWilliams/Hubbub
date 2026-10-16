/**
 * Token bucket: allows bursts up to `capacity`, then `perSecond` on average. Used to drop floods from other
 * people (or from a buggy client) instead of doing work for every message. The clock is injectable for tests.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now: number = performance.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  allow(now: number = performance.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
