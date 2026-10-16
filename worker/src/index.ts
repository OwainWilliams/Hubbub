export { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Origin allowed to call the Worker, e.g. https://<user>.github.io. Unset allows any (dev only). */
  ALLOWED_ORIGIN?: string;
}

function cors(env: Env): HeadersInit {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN ?? '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'hubbub-signal' }, { headers: cors(env) });
    }

    // Phase 1: WebSocket upgrade at /room/<code> is routed to that room's Durable Object.
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9-]{3,64})$/);
    if (match) {
      const id = env.ROOMS.idFromName(match[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response('Not found', { status: 404, headers: cors(env) });
  },
} satisfies ExportedHandler<Env>;
