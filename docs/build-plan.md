# Hubbub: Build Plan

A browser-based meeting town in 2D for coworkers and friends. Up to 12 people walk around a generated town, chat by text and proximity voice, and meet in private buildings with live screen sharing. Rooms exist only while someone is in them. Free to host.

Mock screens: https://claude.ai/artifact/Bx5na81Dedhn8HefsMTzvy (placeholder art; the final art is pixel art from the packs below).

## 1. Decisions already made

| Area | Decision |
|---|---|
| Users | Coworkers and friends, max 12 per room |
| Platform | Desktop browser first. Mobile gets text chat only (see open item 1) |
| Accounts | None. Name and avatar are remembered in the browser |
| World | Generated from a seed, in chunks, growing as people walk |
| Buildings | Enterable, private voice and chat inside, generated interiors |
| Screen share | Live via the browser, shown on an in-world TV. Nothing is recorded |
| Persistence | None. A room vanishes when empty. The seed comes from the room code, so rejoining recreates the same town |
| Moderation | None |
| Art | Kenney packs (CC0) for buildings and props, the LPC generator for avatars |
| Hosting | GitHub Pages (app), Cloudflare free tier (signalling and relay) |

## 2. Architecture

```
Browser A ──┐                          ┌── Browser B
            ├── WebRTC (direct) ───────┤     data: positions, chat
            │   voice, screen share    │
            └── WebSocket ── Cloudflare Worker + Durable Object (one per room)
                              introduces peers, relays offers/answers/ICE
Fallback when a direct link fails: Cloudflare TURN relay
```

- **App:** static TypeScript, built with Vite and deployed to GitHub Pages.
- **Rendering:** Phaser 3 (tilemaps, sprite layers, camera). Pixel-art settings on.
- **Signalling:** a Cloudflare Worker with a Durable Object per room code. It tracks who is connected, hands out peer ids, and forwards WebRTC offers, answers and ICE candidates. It stores nothing and the room disappears when the last socket closes.
- **Peer links:** full mesh, so 12 people means 66 connections. Each pair has one data channel (unreliable, for positions) and one reliable channel (chat, join/leave, state).
- **Relay:** Cloudflare's TURN service, used only when a direct link fails. The Worker issues short-lived credentials so no secret is in the client.
- **Seed:** `seed = hash(roomCode)`. Chunk contents come from `hash(seed, chunkX, chunkY)`, and building interiors from `hash(seed, buildingId)`. Every client generates identical content, so no map data is sent.

## 3. Repository layout

```
hubbub/
├── app/                 # Vite + TypeScript client
│   ├── src/
│   │   ├── main.ts
│   │   ├── game/        # scenes, player, camera, input
│   │   ├── world/       # seeded RNG, chunk generator, tileset, buildings
│   │   ├── avatar/      # layer definitions, builder UI, sprite compositor
│   │   ├── net/         # signalling client, peer manager, messages
│   │   ├── voice/       # audio graph, proximity logic
│   │   ├── share/       # screen share and TV rendering
│   │   └── ui/          # join screen, chat, HUD, credits
│   └── public/assets/   # packs, with licence files kept next to them
├── worker/              # Cloudflare Worker + Durable Object (wrangler)
├── docs/                # requirements, this plan, asset licences
└── .github/workflows/   # build and deploy to Pages
```

## 4. Phases

Each phase ends with something runnable and a short test checklist. Build in this order, because each phase depends on the previous one.

### Phase 0: Skeleton (about half a day)
- Repo, Vite + TypeScript, Phaser, lint and formatting.
- GitHub Actions deploy to GitHub Pages.
- Worker project with `wrangler`, deployed to a `workers.dev` URL.
- Credits page with Kenney and LPC attribution, even if empty at first.
- **Done when:** the empty app is live on Pages and the Worker answers a health check.

### Phase 1: Walk and chat (the core loop)
- Join screen: name and room code (random code if empty).
- Signalling over WebSocket, peer discovery, WebRTC mesh with data channels.
- A single fixed test map. Players walk with WASD or arrows. Positions sent at 10-15 Hz and interpolated on receipt.
- Speech bubbles and a chat log.
- Join and leave handled cleanly, including a refresh mid-session.
- **Done when:** two browsers on different networks see each other move and chat, and a third can join and leave.

### Phase 2: Avatars
- Download the LPC sprite sheets and decide which layers to offer: body, skin, hair, hat, robe, extra.
- Avatar builder from the mock screen. Layers composited into one sprite sheet at runtime.
- Look sent as a small JSON when peers connect, and stored in `localStorage`.
- **Done when:** each player appears to others with their chosen look, with walk animation in four directions.

### Phase 3: Generated world
- Seeded RNG and string hashing (a small fast hash such as cyrb53 and mulberry32).
- Chunk generator using the Kenney tiles: streets, plazas, houses, market, park, river.
- Load chunks around each player and unload distant ones. Collision from the tile data.
- A debug view of seed and chunk coordinates.
- **Done when:** two clients with the same room code see an identical town, a different code gives a different town, and walking far never hits an edge.

### Phase 4: Buildings
- Mark some chunks as buildings with a door. Walking into the door switches to the interior scene.
- Generated interior from the building seed: floor, furniture, a TV or project table.
- A "room id" per building on the network. Chat and voice are scoped to people in the same room id.
- **Done when:** people inside a building cannot see the chat of people outside, and vice versa.

### Phase 5: Proximity voice
- Microphone permission flow, mute button, device selection.
- One audio element per remote peer routed through a Web Audio graph (gain per peer, optional stereo pan).
- Volume falls off with distance. Outside the range, the stream is silenced and, to save bandwidth, the audio track is disabled with hysteresis so people don't flicker at the edge.
- Inside a building, everyone in the room hears everyone.
- Speaking indicator above avatars.
- **Done when:** three people in a street hear each other based on distance, and a person out of range hears nothing.

### Phase 6: Screen sharing
- At the TV, a "Share screen" action starts `getDisplayMedia`.
- The stream goes only to peers inside the same building. Viewers see it rendered onto the in-world TV, with a full-screen option.
- Quality: set the capture hint for text (`contentHint = 'text'`), start at 720p, and lower the bitrate or frame rate as viewers are added (cap about 5-6 viewers).
- Stop sharing cleanly when the sharer leaves, closes the picker or ends the capture from the browser UI.
- **Done when:** one person shares a window and three others see it live, and the TV goes blank when sharing stops.

### Phase 7: Polish and hardening
- Mobile layout with text chat only (and tap-to-walk if wanted).
- Reconnection when a peer's link drops. TURN fallback tested on a restrictive network.
- Loading states, error messages for denied mic or screen permissions, room-full message at 12.
- Performance pass on many sprites and chunks.
- Credits screen finished with all attributions.

## 5. Key technical notes and risks

| Risk | Mitigation |
|---|---|
| Direct links fail on corporate networks | TURN fallback from day one. Test early in Phase 1 on a locked-down network. |
| Mesh bandwidth for screen share | Cap viewers, scale quality, send only inside the room. If 12 viewers are ever needed, move that stream to Cloudflare's SFU. |
| Browsers require a click before audio plays | Start audio from the join button. |
| Screen share does not work on phones | Phones can watch at most. State this in the UI. |
| Everyone must generate the same world | Use only integer maths and seeded RNG in the generator. Add a test that hashes chunk output for known seeds. |
| Clock and position drift | Send positions with sequence numbers and interpolate. The world itself is deterministic, so drift affects only avatars. |
| Free-tier limits | I will re-check current Cloudflare Workers, Durable Objects and TURN limits before Phase 0. With at most 12 users, we expect to be well inside them. |
| LPC licence | LPC art is mostly CC-BY-SA or GPL. Keep each asset's credit with its file, export the credits list, show it in the app, and keep derived art under the same licence. |

## 6. Testing

- Unit tests (Vitest) for the seeded generator, hashing and distance-to-volume curve.
- A small script that opens N headless browser clients against a local Worker to check join, leave and message delivery.
- A manual checklist per phase, run with two to four real people before moving on.

## 7. Open items

1. Should phones be able to walk around, or only chat? (Plan assumes chat only, with tap-to-walk as an optional extra.)
2. Room codes: random only, or can people choose them? (Plan assumes both.)
3. Confirm the LPC share-alike and credit terms are acceptable for this project.
4. Pick the exact Kenney packs and LPC layers (I can shortlist from what you download).
5. Check "Hubbub" isn't already taken in a way that matters (GitHub, domain, trademark).

## 8. Suggested first step

Create the repo, then do Phase 0 and the first half of Phase 1 (signalling plus two browsers seeing each other), because the network layer is the biggest unknown. Everything else is conventional once two peers can talk.
