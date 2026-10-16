import type { Env } from './env';

export { Room } from './room';
export type { Env };

const LOCAL_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** True when the request's Origin may use this Worker. With ALLOWED_ORIGIN unset, everything is allowed. */
function originAllowed(request: Request, env: Env): boolean {
  if (!env.ALLOWED_ORIGIN) return true;
  const origin = request.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
  return allowed.includes(origin) || LOCAL_DEV.test(origin);
}

function cors(request: Request, env: Env): HeadersInit {
  const base = {
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
  if (!env.ALLOWED_ORIGIN) return { ...base, 'access-control-allow-origin': '*' };
  const origin = request.headers.get('origin') ?? '';
  return originAllowed(request, env) ? { ...base, 'access-control-allow-origin': origin } : base;
}

/** STUN always; Cloudflare TURN credentials too when the secrets are set. Failures fall back to STUN only. */
async function iceServers(env: Env): Promise<unknown[]> {
  const servers: unknown[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return servers;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!res.ok) return servers;
    const body = (await res.json()) as { iceServers?: unknown };
    const extra = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    for (const s of extra as { urls?: string | string[] }[]) {
      // Browsers block TURN on port 53, so drop those URLs.
      const urls = ([] as string[]).concat(s.urls ?? []).filter((u) => !/:53(\?|$)/.test(u));
      if (urls.length) servers.push({ ...s, urls });
    }
  } catch {
    // Keep STUN only.
  }
  return servers;
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

    if (url.pathname === '/ice') {
      return Response.json({ iceServers: await iceServers(env) }, { headers: cors(request, env) });
    }

    // WebSocket upgrade at /room/<code> is routed to that room's Durable Object.
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9-]{3,64})$/);
    if (match) {
      if (!originAllowed(request, env)) return new Response('Forbidden', { status: 403 });
      const id = env.ROOMS.idFromName(match[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response('Not found', { status: 404, headers: cors(request, env) });
  },
} satisfies ExportedHandler<Env>;
