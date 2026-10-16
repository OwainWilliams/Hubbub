# Hubbub

A browser-based meeting town in 2D for coworkers and friends. Up to 12 people walk around a generated town, chat by text and proximity voice, and meet in private buildings with live screen sharing. Rooms exist only while someone is in them. Designed to be free to host.

First-time setup: [docs/SETUP.md](docs/SETUP.md). Plan and decisions: [docs/build-plan.md](docs/build-plan.md). The 3D view: [docs/3d.md](docs/3d.md). Asset credits: [docs/ASSET-CREDITS.md](docs/ASSET-CREDITS.md).

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
- Phase 1 (walk and chat): built and tested with real browsers on one machine. Not yet tested across different networks or with TURN. See [docs/protocol.md](docs/protocol.md).
- Phase 3 (generated world) and Phase 4 (buildings): built and tested. The town is endless and identical for everyone in a room; four kinds of square (houses, market, park, plaza); enterable buildings with generated interiors; private chat inside. Art is placeholder shapes, kept in `app/src/game/art.ts` so a Kenney tileset can replace it.
- Phase 5 (proximity voice) and Phase 6 (screen sharing): built and tested with real browsers using a fake microphone and a fake screen. Browsers' real screen picker and real speakers could not be tested automatically.
- Phase 2 (avatars): a builder on the join screen (kind, hat, robe, skin, extras), remembered in the browser and shown to everyone, with facing and a walking bob. The drawing is placeholder SVG in `app/src/avatar/`; replacing it with layered LPC sprites only touches that folder.
- Phase 7 (reliability and polish): broken peer links reconnect by themselves, a dropped server connection rejoins automatically, rate limits on the server and between people, click or tap to walk, a phone layout (text chat, tap to walk and watching a shared screen; no mic or sharing on phones).
- 3D view: the same town and game in three.js with an orbiting third-person camera, chosen on the join screen. See [docs/3d.md](docs/3d.md).
- Still to do: swap the placeholder art for Kenney and LPC packs, try it across real networks (with TURN), and a credits screen generated from the licence list.
