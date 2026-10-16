// Wire formats. Keep in step with worker/src/room.ts and docs/protocol.md.

export const MAX_PEERS = 12;
export const MAX_NAME = 24;
export const MAX_CHAT = 200;

export interface PeerInfo {
  id: string;
  name: string;
  color: string;
}

export type SignalData =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export type ServerMsg =
  | { type: 'welcome'; id: string; peers: PeerInfo[] }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'signal'; from: string; data: SignalData };

export type ClientMsg =
  | { type: 'hello'; name: string; color: string }
  | { type: 'signal'; to: string; data: SignalData };

/**
 * Position update, sent on the unordered "state" channel. `s` is a sequence number so late packets can be dropped.
 * `r` is the place the position is in: absent when outdoors, otherwise the id of the building they are inside.
 * Positions are world pixels outdoors and room pixels indoors, so they only mean something to people in the same place.
 */
export interface StateMsg {
  t: 'p';
  x: number;
  y: number;
  s: number;
  r?: string;
}

export const MAX_PLACE = 64;

/** Chat line, sent on the reliable "chat" channel. */
export interface ChatMsg {
  t: 'c';
  text: string;
}

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function cleanName(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return s.slice(0, MAX_NAME) || 'Guest';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePeer(v: unknown): PeerInfo | null {
  if (!isObject(v) || typeof v.id !== 'string' || !isColor(v.color)) return null;
  return { id: v.id, name: cleanName(v.name), color: v.color };
}

function parseSignalData(v: unknown): SignalData | null {
  if (!isObject(v)) return null;
  if ((v.kind === 'offer' || v.kind === 'answer') && typeof v.sdp === 'string') return { kind: v.kind, sdp: v.sdp };
  if (v.kind === 'ice' && isObject(v.candidate)) return { kind: 'ice', candidate: v.candidate as RTCIceCandidateInit };
  return null;
}

export function parseServerMsg(raw: unknown): ServerMsg | null {
  const m = parseJson(raw);
  if (!isObject(m)) return null;
  switch (m.type) {
    case 'welcome': {
      if (typeof m.id !== 'string' || !Array.isArray(m.peers)) return null;
      const peers = m.peers.map(parsePeer);
      if (peers.some((p) => p === null)) return null;
      return { type: 'welcome', id: m.id, peers: peers as PeerInfo[] };
    }
    case 'peer-joined': {
      const peer = parsePeer(m.peer);
      return peer ? { type: 'peer-joined', peer } : null;
    }
    case 'peer-left':
      return typeof m.id === 'string' ? { type: 'peer-left', id: m.id } : null;
    case 'signal': {
      const data = parseSignalData(m.data);
      return typeof m.from === 'string' && data ? { type: 'signal', from: m.from, data } : null;
    }
    default:
      return null;
  }
}

export function parseStateMsg(raw: unknown): StateMsg | null {
  const m = parseJson(raw);
  if (!isObject(m) || m.t !== 'p') return null;
  if (typeof m.x !== 'number' || typeof m.y !== 'number' || typeof m.s !== 'number') return null;
  if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.s)) return null;
  if (m.r !== undefined && (typeof m.r !== 'string' || m.r.length > MAX_PLACE)) return null;
  return m.r ? { t: 'p', x: m.x, y: m.y, s: m.s, r: m.r } : { t: 'p', x: m.x, y: m.y, s: m.s };
}

export function parseChatMsg(raw: unknown): ChatMsg | null {
  const m = parseJson(raw);
  if (!isObject(m) || m.t !== 'c' || typeof m.text !== 'string') return null;
  const text = m.text.trim().slice(0, MAX_CHAT);
  return text ? { t: 'c', text } : null;
}
