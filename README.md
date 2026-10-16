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

### Tests

```sh
# Unit tests
cd app && npm test

# End-to-end (real browsers; needs both dev servers above running)
cd e2e && npm install
CHROMIUM=/path/to/chromium npm test   # CHROMIUM is optional if Playwright's browsers are installed
```

The end-to-end tests join three browsers to one room and check they connect, chat, see each other move, and that the room limit (12) and origin check work.

## Deploy

**App (GitHub Pages):**
1. In the repo, go to Settings > Pages and set Source to **GitHub Actions**.
2. Deploy the Worker (below), then add a repository variable `WORKER_URL` (Settings > Secrets and variables > Actions > Variables) set to the Worker's URL.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds `app/` and publishes it.

**Worker (Cloudflare), automatic:** pushes to `main` that change `worker/` deploy it via `.github/workflows/deploy-worker.yml`. One-time setup:
1. In Cloudflare, go to My Profile > API Tokens > Create Token and use the **Edit Cloudflare Workers** template. Copy the token.
2. In this repo, go to Settings > Secrets and variables > Actions > Secrets and add `CLOUDFLARE_API_TOKEN`. If your token covers more than one Cloudflare account, also add `CLOUDFLARE_ACCOUNT_ID`.
3. Run the workflow once from the Actions tab (Deploy Worker to Cloudflare > Run workflow). The deployed URL appears in the log. Put it in the repo variable `WORKER_URL`, then re-run the app workflow.

**Worker, manual:**
```sh
cd worker
npm install
npx wrangler login
npm run deploy
```
Browser access is restricted by `ALLOWED_ORIGIN` in `worker/wrangler.toml` (currently `https://thesecretstage.vip`; use a comma-separated list for more than one). `localhost` is always allowed for development. The app is published at https://thesecretstage.vip/Hubbub/ (the path is case-sensitive).

**Optional: TURN relay for networks that block direct connections.** In Cloudflare, create a TURN key (Realtime > TURN), then:
```sh
cd worker
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```
Secrets survive redeploys. Without them the app uses STUN only.

## Status

- Phase 0 (skeleton): done.
- Phase 1 (walk and chat): built and tested with real browsers on one machine. Not yet tested across different networks or with TURN. Players are coloured circles on an empty grid. See [docs/protocol.md](docs/protocol.md).
- Next: Phase 2 (avatars) and Phase 3 (generated world).
