import { parseServerMsg, type ClientMsg, type ServerMsg } from './protocol';

const PING_MS = 25_000;

/** WebSocket link to the room's Durable Object. Only used to find peers and exchange WebRTC setup messages. */
export class Signalling {
  onmessage: (m: ServerMsg) => void = () => {};
  onclose: (code: number) => void = () => {};

  private ws: WebSocket | null = null;
  private ping: number | undefined;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
        resolve();
      };
      ws.onmessage = (e) => {
        const m = parseServerMsg(e.data); // 'pong' and junk parse to null and are ignored
        if (m) this.onmessage(m);
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Could not reach the server.'));
      };
      ws.onclose = (e) => {
        window.clearInterval(this.ping);
        if (!opened) reject(new Error('Could not reach the server.'));
        else this.onclose(e.code);
      };
    });
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    window.clearInterval(this.ping);
    this.ws?.close(1000);
  }
}
