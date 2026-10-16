import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lookLimits, type Look } from '../../avatar/look';
import { buildAvatarModel, disposeObject } from './avatarMesh';
import { wrapText } from './labels';

describe('buildAvatarModel', () => {
  it('builds every combination, standing on the ground with a sensible height', () => {
    const lim = lookLimits();
    let count = 0;
    for (let kind = 0; kind < lim.kind; kind++)
      for (let hat = 0; hat < lim.hat; hat++)
        for (let robe = 0; robe < lim.robe; robe++)
          for (let skin = 0; skin < lim.skin; skin++)
            for (let extra = 0; extra < lim.extra; extra++) {
              const look: Look = { kind, hat, robe, skin, extra };
              const m = buildAvatarModel(look);
              const box = new THREE.Box3().setFromObject(m.group);
              expect(Number.isFinite(box.min.y) && Number.isFinite(box.max.y)).toBe(true);
              expect(box.min.y).toBeGreaterThan(-0.05); // feet on the ground
              expect(box.max.y).toBeGreaterThan(1.0); // the shortest, a hatless dwarf, is about 1.17
              expect(box.max.y).toBeLessThan(2.6);
              expect(m.height).toBeGreaterThan(1.0);
              expect(m.arms).toHaveLength(2);
              disposeObject(m.group);
              count++;
            }
    expect(count).toBe(lim.kind * lim.hat * lim.robe * lim.skin * lim.extra);
  });

  it('makes dwarfs shorter and trolls taller than humans, and tall hats add height', () => {
    const h = (kind: number, hat = 3) => buildAvatarModel({ kind, hat, robe: 0, skin: 0, extra: 0 }).height;
    expect(h(1)).toBeLessThan(h(0));
    expect(h(2)).toBeGreaterThan(h(0));
    expect(h(0, 0)).toBeGreaterThan(h(0, 3));
  });

  it('uses the chosen robe colour', () => {
    const colorOf = (robe: number) => {
      const m = buildAvatarModel({ kind: 0, hat: 3, robe, skin: 0, extra: 0 });
      const first = m.body.children[0] as THREE.Mesh;
      return (first.material as THREE.MeshLambertMaterial).color.getHex();
    };
    expect(colorOf(0)).not.toBe(colorOf(3));
  });
});

describe('wrapText', () => {
  const measure = (s: string) => s.length * 10; // every character is 10px wide
  it('keeps short text on one line', () => {
    expect(wrapText('hello there', 300, measure)).toEqual(['hello there']);
  });
  it('wraps at word boundaries', () => {
    const lines = wrapText('one two three four five six', 100, measure);
    expect(lines.every((l) => measure(l) <= 100)).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five six');
  });
  it('cuts a very long word instead of overflowing', () => {
    const lines = wrapText('x'.repeat(45), 100, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => measure(l) <= 100)).toBe(true);
  });
  it('limits how tall a bubble can get', () => {
    expect(wrapText(Array.from({ length: 200 }, () => 'word').join(' '), 100, measure).length).toBeLessThanOrEqual(6);
  });
  it('copes with empty and whitespace-only text', () => {
    expect(wrapText('', 100, measure)).toEqual([]);
    expect(wrapText('   ', 100, measure)).toEqual([]);
  });
});
