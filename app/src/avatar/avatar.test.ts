import { describe, expect, it } from 'vitest';
import { defaultLook, lookFromWire, lookKey, lookLimits, lookToWire, parseLook, randomLook } from './look';
import { avatarSvg } from './svg';

describe('look', () => {
  it('survives the wire format', () => {
    const l = { kind: 2, hat: 3, robe: 4, skin: 1, extra: 2 };
    expect(lookFromWire(lookToWire(l))).toEqual(l);
  });
  it('rejects malformed wire values and falls back to defaults when parsing', () => {
    expect(lookFromWire([1, 2, 3])).toBeNull();
    expect(lookFromWire('nope')).toBeNull();
    expect(lookFromWire([0, 0, 0, 0, 99])).toBeNull();
    expect(lookFromWire([0, 0, 0, 0, 1.5])).toBeNull();
    expect(parseLook(null)).toEqual(defaultLook());
    expect(parseLook({ kind: 99, hat: -1, robe: 'x' })).toEqual(defaultLook());
  });
  it('clamps values that are valid on the wire but outside the art we have', () => {
    expect(lookFromWire([9, 9, 9, 9, 9])).toEqual(defaultLook());
  });
  it('random looks are always valid', () => {
    const lim = lookLimits();
    for (let i = 0; i < 200; i++) {
      const l = randomLook();
      for (const k of Object.keys(lim) as (keyof typeof lim)[]) {
        expect(l[k]).toBeGreaterThanOrEqual(0);
        expect(l[k]).toBeLessThan(lim[k]);
      }
    }
  });
});

describe('avatarSvg', () => {
  it('draws every combination as well-formed SVG', () => {
    const lim = lookLimits();
    const keys = new Set<string>();
    for (let kind = 0; kind < lim.kind; kind++)
      for (let hat = 0; hat < lim.hat; hat++)
        for (let robe = 0; robe < lim.robe; robe++)
          for (let skin = 0; skin < lim.skin; skin++)
            for (let extra = 0; extra < lim.extra; extra++) {
              const l = { kind, hat, robe, skin, extra };
              const svg = avatarSvg(l);
              expect(svg.startsWith('<svg')).toBe(true);
              expect(svg.endsWith('</svg>')).toBe(true);
              expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
              expect(svg).not.toContain('undefined');
              keys.add(lookKey(l));
            }
    expect(keys.size).toBe(lim.kind * lim.hat * lim.robe * lim.skin * lim.extra);
  });
  it('changes when the look changes', () => {
    expect(avatarSvg({ ...defaultLook(), robe: 1 })).not.toBe(avatarSvg({ ...defaultLook(), robe: 2 }));
  });
});
