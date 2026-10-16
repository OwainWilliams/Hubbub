export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Comma-separated origins allowed to call the Worker, e.g. https://thesecretstage.vip. Unset allows any. */
  ALLOWED_ORIGIN?: string;
  /** Optional Cloudflare TURN credentials (set with `wrangler secret put`). Without them only STUN is offered. */
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
}
