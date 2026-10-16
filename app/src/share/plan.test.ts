import { describe, expect, it } from 'vitest';
import { MAX_VIEWERS, UPLOAD_BUDGET, pickViewers, planVideo } from './plan';

describe('planVideo', () => {
  it('gives each viewer less as more join, but never nothing', () => {
    let last = Infinity;
    for (let n = 1; n <= 12; n++) {
      const { bitrate } = planVideo(n);
      expect(bitrate).toBeLessThanOrEqual(last);
      expect(bitrate).toBeGreaterThanOrEqual(300_000);
      last = bitrate;
    }
  });
  it('keeps the total within the upload budget at the viewer limit', () => {
    expect(planVideo(MAX_VIEWERS).bitrate * MAX_VIEWERS).toBeLessThanOrEqual(UPLOAD_BUDGET);
  });
  it('shrinks the picture for bigger audiences', () => {
    expect(planVideo(1).scaleDownBy).toBe(1);
    expect(planVideo(3).scaleDownBy).toBeGreaterThan(1);
    expect(planVideo(6).scaleDownBy).toBeGreaterThan(planVideo(3).scaleDownBy);
  });
  it('treats zero viewers like one', () => {
    expect(planVideo(0)).toEqual(planVideo(1));
  });
});

describe('pickViewers', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
  it('lets the first few watch and turns away the rest', () => {
    const { watching, full } = pickViewers(ids);
    expect(watching).toHaveLength(MAX_VIEWERS);
    expect(full).toHaveLength(3);
    expect(new Set([...watching, ...full]).size).toBe(9);
  });
  it('never bumps someone who is already watching', () => {
    const current = new Set(['p7', 'p8']);
    const { watching } = pickViewers(ids, MAX_VIEWERS, current);
    expect(watching).toContain('p7');
    expect(watching).toContain('p8');
  });
  it('gives everyone a place in a small room', () => {
    expect(pickViewers(['b', 'a']).watching).toEqual(['a', 'b']);
    expect(pickViewers([]).watching).toEqual([]);
  });
});
