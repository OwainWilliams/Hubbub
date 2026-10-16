import { describe, expect, it } from 'vitest';
import { FULL_RANGE, HEAR_RANGE, HYSTERESIS, gainFor, panFor, shouldHear, volumeFor } from './range';

describe('volumeFor', () => {
  it('is full close up, silent far away, and falls steadily in between', () => {
    expect(volumeFor(0)).toBe(1);
    expect(volumeFor(FULL_RANGE)).toBe(1);
    expect(volumeFor(HEAR_RANGE)).toBe(0);
    expect(volumeFor(HEAR_RANGE * 3)).toBe(0);
    let last = 1;
    for (let d = FULL_RANGE; d <= HEAR_RANGE; d += 10) {
      const v = volumeFor(d);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });
});

describe('shouldHear', () => {
  const base = { samePlace: true, indoors: false, distance: 200, wasAudible: false };
  it('needs the same place', () => {
    expect(shouldHear(base)).toBe(true);
    expect(shouldHear({ ...base, samePlace: false })).toBe(false);
    expect(shouldHear({ ...base, samePlace: false, indoors: true, distance: 0 })).toBe(false);
  });
  it('outdoors depends on distance', () => {
    expect(shouldHear({ ...base, distance: HEAR_RANGE - 1 })).toBe(true);
    expect(shouldHear({ ...base, distance: HEAR_RANGE + 1 })).toBe(false);
  });
  it('has a margin so audio does not flicker at the edge', () => {
    const edge = HEAR_RANGE + 10;
    expect(shouldHear({ ...base, distance: edge, wasAudible: false })).toBe(false);
    expect(shouldHear({ ...base, distance: edge, wasAudible: true })).toBe(true);
    expect(shouldHear({ ...base, distance: HEAR_RANGE * HYSTERESIS + 1, wasAudible: true })).toBe(false);
  });
  it('indoors everyone hears everyone at any distance', () => {
    expect(shouldHear({ ...base, indoors: true, distance: 5000 })).toBe(true);
  });
});

describe('gainFor', () => {
  it('is 1 indoors, 0 in different places, and distance based outdoors', () => {
    expect(gainFor({ samePlace: true, indoors: true, distance: 900 })).toBe(1);
    expect(gainFor({ samePlace: false, indoors: false, distance: 0 })).toBe(0);
    expect(gainFor({ samePlace: true, indoors: false, distance: 50 })).toBe(1);
    expect(gainFor({ samePlace: true, indoors: false, distance: 500 })).toBe(0);
  });
});

describe('panFor', () => {
  it('puts people on the side they stand and stays within bounds', () => {
    expect(panFor(200, 200)).toBeGreaterThan(0);
    expect(panFor(-200, 200)).toBeLessThan(0);
    expect(panFor(0, 0)).toBe(0);
    expect(Math.abs(panFor(1e6, 1e6))).toBeLessThanOrEqual(1);
  });
});
