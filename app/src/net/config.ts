// Set VITE_WORKER_URL at build time (or in app/.env) to your deployed Worker, e.g. https://hubbub-signal.<you>.workers.dev
export const WORKER_URL: string = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';
