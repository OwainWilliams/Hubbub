import type { Env } from './env';

/**
 * One instance per room code. It keeps no stored data: it exists only while sockets are connected, so a
 * room vanishes when the last person leaves. It introduces peers to each other and relays WebRTC
 * offers, answers and ICE candidates. Chat, positions, voice and video never pass through here.
 *
 * Protocol (JSON text frames), see docs/protocol.md:
 *   client -> server  {type:'hello', name, color} | {type:'signal', to, data}
 *   server -> client  {type:'welcome', id, peers} | {type:'peer-joined', peer} | {type:'peer-left', id}
 *                     | {type:'signal', from, data}
 */

const MAX_PEERS = 12;
const MAX_MESSAGE_CHARS = 16 * 1024;
const MAX_NAME = 24;
const JOIN_DEADLINE_MS = 10_000;
const CLOSE_ROOM_FULL = 4001;

interface PeerInfo {
  id: string;
  name: string;
  color: string;
}

interface Attachment extends PeerInfo {
  joined: boolean;
  connectedAt: number;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return s.slice(0, MAX_NAME) || 'Guest';
}

function cleanColor(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#d9a441';
}

export class Room implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {
    // Keepalive pings are answered without waking the object.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket connection', { status: 426 });
    }

    const full = this.state.getWebSockets().length >= MAX_PEERS;
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);

    if (full) {
      server.close(CLOSE_ROOM_FULL, 'room-full');
    } else {
      const att: Attachment = { id: newId(), name: '', color: '#d9a441', joined: false, connectedAt: Date.now() };
      server.serializeAttachment(att);
      // Sockets that never say hello are swept so they cannot hold seats in the room.
      if ((await this.state.storage.getAlarm()) === null) {
        await this.state.storage.setAlarm(Date.now() + JOIN_DEADLINE_MS);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let pending = false;
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && !att.joined) {
        if (now - att.connectedAt >= JOIN_DEADLINE_MS) ws.close(4002, 'no-hello');
        else pending = true;
      }
    }
    if (pending) await this.state.storage.setAlarm(now + JOIN_DEADLINE_MS);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_CHARS) {
      ws.close(1009, 'bad-message');
      return;
    }
    let msg: { type?: unknown; [k: string]: unknown };
    try {
      msg = JSON.parse(message) as typeof msg;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || typeof msg !== 'object' || msg === null) return;

    if (msg.type === 'hello' && !att.joined) {
      att.name = cleanName(msg.name);
      att.color = cleanColor(msg.color);
      att.joined = true;
      ws.serializeAttachment(att);
      ws.send(JSON.stringify({ type: 'welcome', id: att.id, peers: this.peersExcept(ws) }));
      this.broadcast({ type: 'peer-joined', peer: { id: att.id, name: att.name, color: att.color } }, ws);
      return;
    }

    if (msg.type === 'signal' && att.joined && typeof msg.to === 'string') {
      const data = msg.data as { kind?: unknown } | null;
      if (!data || typeof data !== 'object' || !['offer', 'answer', 'ice'].includes(data.kind as string)) return;
      for (const other of this.state.getWebSockets()) {
        const o = other.deserializeAttachment() as Attachment | null;
        if (o?.joined && o.id === msg.to && other !== ws) {
          other.send(JSON.stringify({ type: 'signal', from: att.id, data }));
          return;
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.leave(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  private leave(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.joined) this.broadcast({ type: 'peer-left', id: att.id }, ws);
  }

  private peersExcept(skip: WebSocket): PeerInfo[] {
    const peers: PeerInfo[] = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (ws !== skip && a?.joined) peers.push({ id: a.id, name: a.name, color: a.color });
    }
    return peers;
  }

  private broadcast(payload: unknown, skip: WebSocket): void {
    const text = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (ws === skip || !a?.joined) continue;
      try {
        ws.send(text);
      } catch {
        // Socket is closing; its own close handler will announce it.
      }
    }
  }
}
