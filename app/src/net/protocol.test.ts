import { describe, expect, it } from 'vitest';
import { cleanName, parseChatMsg, parseServerMsg, parseStateMsg } from './protocol';

const peer = { id: 'abc12345', name: 'Brenda', color: '#5f7a5a' };

describe('parseServerMsg', () => {
  it('accepts valid messages', () => {
    expect(parseServerMsg(JSON.stringify({ type: 'welcome', id: 'me', peers: [peer] }))).toEqual({ type: 'welcome', id: 'me', peers: [peer] });
    expect(parseServerMsg(JSON.stringify({ type: 'peer-left', id: 'x' }))).toEqual({ type: 'peer-left', id: 'x' });
    expect(parseServerMsg(JSON.stringify({ type: 'signal', from: 'x', data: { kind: 'offer', sdp: 'v=0' } }))).not.toBeNull();
  });
  it('rejects junk, wrong shapes and non-strings', () => {
    expect(parseServerMsg('pong')).toBeNull();
    expect(parseServerMsg(42)).toBeNull();
    expect(parseServerMsg(JSON.stringify({ type: 'welcome', id: 'me', peers: [{ id: 'x', color: 'red' }] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ type: 'signal', from: 'x', data: { kind: 'bogus' } }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ type: 'unknown' }))).toBeNull();
  });
  it('cleans names from other people', () => {
    const m = parseServerMsg(JSON.stringify({ type: 'peer-joined', peer: { ...peer, name: '  \u0007Bad\u0000Name  ' } }));
    expect(m).toMatchObject({ peer: { name: 'BadName' } });
  });
});

describe('parseStateMsg', () => {
  it('accepts finite numbers only', () => {
    expect(parseStateMsg('{"t":"p","x":1.5,"y":2,"s":3}')).toEqual({ t: 'p', x: 1.5, y: 2, s: 3 });
    expect(parseStateMsg('{"t":"p","x":"1","y":2,"s":3}')).toBeNull();
    expect(parseStateMsg('{"t":"p","x":null,"y":2,"s":3}')).toBeNull();
    expect(parseStateMsg('nope')).toBeNull();
  });
});

describe('parseChatMsg', () => {
  it('trims, caps length and drops empty lines', () => {
    expect(parseChatMsg('{"t":"c","text":"  hi  "}')).toEqual({ t: 'c', text: 'hi' });
    expect(parseChatMsg(JSON.stringify({ t: 'c', text: 'x'.repeat(500) }))?.text).toHaveLength(200);
    expect(parseChatMsg('{"t":"c","text":"   "}')).toBeNull();
  });
});

describe('cleanName', () => {
  it('falls back to Guest and caps length', () => {
    expect(cleanName('')).toBe('Guest');
    expect(cleanName(undefined)).toBe('Guest');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
  });
});
