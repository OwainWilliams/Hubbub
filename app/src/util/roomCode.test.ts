import { describe, expect, it } from 'vitest';
import { normaliseRoomCode, randomRoomCode } from './roomCode';

describe('normaliseRoomCode', () => {
  it('upper-cases and tidies separators', () => {
    expect(normaliseRoomCode('  damp lantern_42 ')).toBe('DAMP-LANTERN-42');
    expect(normaliseRoomCode('a--b---c')).toBe('A-B-C');
  });
  it('rejects too short, too long and odd characters', () => {
    expect(normaliseRoomCode('ab')).toBeNull();
    expect(normaliseRoomCode('x'.repeat(65))).toBeNull();
    expect(normaliseRoomCode('room/../x')).toBeNull();
    expect(normaliseRoomCode('héllo')).toBeNull();
    expect(normaliseRoomCode('')).toBeNull();
  });
});

describe('randomRoomCode', () => {
  it('produces codes that survive normalisation', () => {
    for (let i = 0; i < 50; i++) {
      const code = randomRoomCode();
      expect(code).toMatch(/^[A-Z]+-[A-Z]+-\d{2}$/);
      expect(normaliseRoomCode(code)).toBe(code);
    }
  });
  it('is deterministic for a fixed random source', () => {
    expect(randomRoomCode(() => 0)).toBe('DAMP-LANTERN-10');
  });
});
