# First-time setup checklist

Do these once, on a laptop with a browser. Everything else is already in the repo.

## 1. Cloudflare (signalling server)

1. Create a Cloudflare account if you do not have one (the free plan is enough).
2. **API token:** My Profile > API Tokens > Create Token > use the **Edit Cloudflare Workers** template > Continue to summary > Create. Copy the token now; it is shown once.
3. **Account id:** open any page of your dashboard, the id is in the URL (`dash.cloudflare.com/<account id>/...`) and on the right of the Workers & Pages overview.
4. In this GitHub repo: Settings > Secrets and variables > Actions > **Secrets** > New repository secret:
   - `CLOUDFLARE_API_TOKEN` = the token
   - `CLOUDFLARE_ACCOUNT_ID` = the account id (needed if your token can see more than one account; harmless otherwise)
5. Actions tab > **Deploy Worker to Cloudflare** > Run workflow. When it finishes, the log shows a URL like `https://hubbub-signal.<your-subdomain>.workers.dev`. Open `<that url>/health`; it should say `{"ok":true,...}`.

The Worker restricts browsers to `https://thesecretstage.vip` (and localhost) through `ALLOWED_ORIGIN` in `worker/wrangler.toml`. Change it there if the site moves.

## 2. GitHub Pages (the app)

1. Settings > Pages > Source: **GitHub Actions**.
2. Settings > Secrets and variables > Actions > **Variables** > New repository variable: `WORKER_URL` = the Worker URL from step 1.5 (no trailing slash).
3. Actions tab > **Deploy app to GitHub Pages** > Run workflow.
4. Open the site. The path is case-sensitive: `https://thesecretstage.vip/Hubbub/`. The join screen should say **Server reachable** at the bottom.

## 3. Try it

1. Open the site in two browsers (or a browser and your phone) and join the same room code.
2. Walk up to a building and through its door. Turn the mic on. Share a screen. Check each of these works for the second person too.
3. **Try it from a work or guest network.** If people there cannot see or hear each other, direct connections are being blocked, so set up TURN (next step).

## 4. Optional: TURN (for networks that block direct connections)

1. Cloudflare dashboard > Realtime > TURN > create a key. Note its **key id** and **API token**.
2. From the `worker` folder on your laptop (after `npm install`):
   ```
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_API_TOKEN
   ```
3. Nothing else to deploy; secrets survive redeploys. In the app, the roster no longer says "could not connect" for people on strict networks.

I could not test TURN myself (it needs your Cloudflare keys), and I am not certain of Cloudflare's current credential endpoint. If TURN does not work after step 2, the Worker's `/ice` route (`worker/src/index.ts`) is the place to look. Open `<worker url>/ice` in a browser: with working keys it lists TURN servers as well as STUN.

## 5. Art

The town and avatars are drawn from simple shapes. To use real art:
- **Buildings and props (Kenney, CC0):** replace `app/src/game/art.ts`; keep the exported `drawChunk` and `drawInterior`.
- **Avatars (LPC):** replace the drawing in `app/src/avatar/svg.ts` and the part lists in `look.ts`. Keep `Look` as five small numbers, or extend the wire format in `docs/protocol.md` and the Worker's `cleanLook`.
- Record every asset and its licence in `docs/ASSET-CREDITS.md` and the in-app Credits screen. LPC art needs credit and is share-alike.

## Running the tests

```
cd app && npm test                 # 59 unit tests
cd e2e && npm install
CHROMIUM=/path/to/chromium npm test   # needs `npm run dev` running in worker/ and app/
```
