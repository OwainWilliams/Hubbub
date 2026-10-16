export { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Comma-separated origins allowed to call the Worker, e.g. https://thesecretstage.vip. Unset allows any. */
  ALLOWED_ORIGIN?: string;
}

function cors(request: Request, env: Env): HeadersInit {
  const base = {
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
  if (!env.ALLOWED_ORIGIN) return { ...base, 'access-control-allow-origin': '*' };

  const origin = request.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
  const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed.includes(origin) || isLocalDev ? { ...base, 'access-control-allow-origin': origin } : base;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'hubbub-signal' }, { headers: cors(request, env) });
    }

    // Phase 1: WebSocket upgrade at /room/<code> is routed to that room's Durable Object.
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9-]{3,64})$/);
    if (match) {
      const id = env.ROOMS.idFromName(match[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response('Not found', { status: 404, headers: cors(request, env) });
  },
} satisfies ExportedHandler<Env>;
