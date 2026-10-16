import { describe, expect, it } from 'vitest';
import { axesFromKeys } from './input';

const axes = (...keys: string[]) => axesFromKeys(new Set(keys));

describe('axesFromKeys', () => {
  it('maps WASD and the arrow keys the same way', () => {
    expect(axes('w')).toEqual({ strafe: 0, forward: 1 });
    expect(axes('arrowup')).toEqual({ strafe: 0, forward: 1 });
    expect(axes('s')).toEqual({ strafe: 0, forward: -1 });
    expect(axes('a')).toEqual({ strafe: -1, forward: 0 });
    expect(axes('arrowright')).toEqual({ strafe: 1, forward: 0 });
  });
  it('combines keys for diagonals', () => {
    expect(axes('w', 'd')).toEqual({ strafe: 1, forward: 1 });
    expect(axes('s', 'a')).toEqual({ strafe: -1, forward: -1 });
  });
  it('cancels opposite keys and ignores everything else', () => {
    expect(axes('a', 'd')).toEqual({ strafe: 0, forward: 0 });
    expect(axes('w', 's')).toEqual({ strafe: 0, forward: 0 });
    expect(axes('x', 'enter', 'shift')).toEqual({ strafe: 0, forward: 0 });
    expect(axes()).toEqual({ strafe: 0, forward: 0 });
  });
});
