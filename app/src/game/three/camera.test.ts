import { describe, expect, it } from 'vitest';
import { INDOOR, OUTDOOR, cameraOffset, clampOrbit, headingFor, inputToGround, turnToward } from './camera';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('inputToGround', () => {
  it('matches the 2D view when the camera has not been turned', () => {
    const r = inputToGround(1, 0, 0);
    close(r.dx, 1);
    close(r.dy, 0);
    const f = inputToGround(0, 1, 0);
    close(f.dx, 0);
    close(f.dy, -1); // forward is north, which is -y
  });
  it('keeps forward pointing away from the camera however it is turned', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1, 5]) {
      const cam = cameraOffset({ yaw, pitch: 0.9, distance: 10 });
      const f = inputToGround(0, 1, yaw);
      // away from the camera means opposite to the camera's horizontal offset
      const dot = f.dx * cam.x + f.dy * cam.z;
      expect(dot).toBeLessThan(0);
      close(Math.hypot(f.dx, f.dy), 1);
    }
  });
  it('puts right on the right-hand side of forward', () => {
    for (const yaw of [0, 1, 2.5, -1.3]) {
      const f = inputToGround(0, 1, yaw);
      const r = inputToGround(1, 0, yaw);
      // looking down from above with z pointing south, right is forward turned clockwise: cross product > 0
      expect(f.dx * r.dy - f.dy * r.dx).toBeGreaterThan(0);
    }
  });
  it('at a quarter turn east-facing camera: forward is west', () => {
    const f = inputToGround(0, 1, Math.PI / 2);
    close(f.dx, -1);
    close(f.dy, 0);
  });
});

describe('cameraOffset', () => {
  it('sits south of the target at yaw 0 and above it', () => {
    const o = cameraOffset({ yaw: 0, pitch: Math.PI / 4, distance: 10 });
    close(o.x, 0);
    expect(o.z).toBeGreaterThan(0);
    close(o.y, Math.sin(Math.PI / 4) * 10);
    close(Math.hypot(o.x, o.y, o.z), 10);
  });
});

describe('clampOrbit', () => {
  it('keeps the camera inside its limits', () => {
    expect(clampOrbit({ yaw: 3, pitch: 0, distance: 1 }, OUTDOOR)).toEqual({ yaw: 3, pitch: OUTDOOR.minPitch, distance: OUTDOOR.minDistance });
    expect(clampOrbit({ yaw: 0, pitch: 3, distance: 99 }, OUTDOOR)).toEqual({ yaw: 0, pitch: OUTDOOR.maxPitch, distance: OUTDOOR.maxDistance });
  });
  it('indoors the camera stays high enough to see over 2.6 unit walls', () => {
    const low = clampOrbit({ yaw: 0, pitch: 0.1, distance: 5 }, INDOOR);
    expect(Math.sin(low.pitch) * low.distance).toBeGreaterThan(2.6);
  });
});

describe('turning', () => {
  it('faces the direction of travel', () => {
    close(headingFor(0, 1), 0); // south
    close(headingFor(1, 0), Math.PI / 2); // east
    close(headingFor(0, -1), Math.PI); // north (or -PI)
  });
  it('turns the short way round', () => {
    // from just under +PI to just over -PI is a tiny step, not a whole turn back
    const next = turnToward(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(next).toBeGreaterThan(Math.PI - 0.1);
    let far = 0;
    for (let i = 0; i < 60; i++) far = turnToward(far, 2, 1 / 60);
    expect(far).toBeGreaterThan(1.9);
    expect(far).toBeLessThanOrEqual(2.0001);
  });
});
