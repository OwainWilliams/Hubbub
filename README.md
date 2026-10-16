# Hubbub

A browser-based meeting town in 2D for coworkers and friends. Up to 12 people walk around a generated town, chat by text and proximity voice, and meet in private buildings with live screen sharing. Rooms exist only while someone is in them. Designed to be free to host.

Plan and decisions: [docs/build-plan.md](docs/build-plan.md). Asset credits: [docs/ASSET-CREDITS.md](docs/ASSET-CREDITS.md).

## Layout

| Folder | What |
|---|---|
| `app/` | Vite + TypeScript + Phaser client, deployed to GitHub Pages |
| `worker/` | Cloudflare Worker + Durable Object used for signalling |
| `docs/` | Plan, requirements and asset credits |

## Develop

```sh
# Worker (terminal 1), serves http://localhost:8787
cd worker && npm install && npm run dev

# App (terminal 2), serves http://localhost:5173
cd app && npm install && npm run dev
```

The app reads the Worker address from `VITE_WORKER_URL` (default `http://localhost:8787`).

## Deploy

**App (GitHub Pages):**
1. In the repo, go to Settings > Pages and set Source to **GitHub Actions**.
2. Deploy the Worker (below), then add a repository variable `WORKER_URL` (Settings > Secrets and variables > Actions > Variables) set to the Worker's URL.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds `app/` and publishes it.

**Worker (Cloudflare):**
```sh
cd worker
npm install
npx wrangler login
npm run deploy
```
After deploying, optionally set `ALLOWED_ORIGIN` (for example `https://<your-username>.github.io`) as a Worker variable to restrict cross-origin access.

## Status

Phase 0 (skeleton) done: app shell, Worker health check, deploy workflow, credits screen. Next is Phase 1: walking and text chat between peers.
