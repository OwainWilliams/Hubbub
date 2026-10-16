import { describe, expect, it } from 'vitest';
import { initialView, usableView } from './view';

describe('initialView', () => {
  it('prefers the address, then the saved choice, then the device', () => {
    expect(initialView('?view=2d', '3d', false)).toBe('2d');
    expect(initialView('?view=3d', '2d', true)).toBe('3d');
    expect(initialView('', '2d', false)).toBe('2d');
    expect(initialView('', null, false)).toBe('3d');
    expect(initialView('', null, true)).toBe('2d');
  });
  it('ignores values it does not know', () => {
    expect(initialView('?view=vr', 'hologram', false)).toBe('3d');
    expect(initialView('?view=', null, true)).toBe('2d');
  });
});

describe('usableView', () => {
  it('falls back to 2D only when 3D is wanted and WebGL is missing', () => {
    expect(usableView('3d', false)).toBe('2d');
    expect(usableView('3d', true)).toBe('3d');
    expect(usableView('2d', false)).toBe('2d');
    expect(usableView('2d', true)).toBe('2d');
  });
});
