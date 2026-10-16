# Network protocol (Phase 1)

Two layers: a WebSocket to the room's Durable Object for setup, and WebRTC data channels directly between people for everything else.

## 1. Signalling (WebSocket)

Connect to `wss://<worker>/room/<ROOMCODE>` (code: 3-64 of `A-Z`, `0-9`, `-`, case-insensitive). The Worker checks the browser `Origin` against `ALLOWED_ORIGIN` (plus localhost). JSON text frames only, 16 KB max.

Client to server:

| Message | Meaning |
|---|---|
| `{"type":"hello","name":"Ann","color":"#d9a441","look":[1,2,3,1,1]}` | Join with a display name (max 24), a colour (used for the roster dot) and an avatar `look`: five small numbers (kind, hat, robe, skin, extra) that the client turns into a picture. Must be sent within 10 s of connecting. |
| `{"type":"signal","to":"<id>","data":{...}}` | Relay a WebRTC setup message to one person. `data` is `{"kind":"offer"\|"answer","sdp":"..."}`, `{"kind":"ice","candidate":{...}}` or `{"kind":"reset"}`. |
| `ping` (plain text) | Keepalive every 25 s. The server answers `pong` without waking. |

Server to client:

| Message | Meaning |
|---|---|
| `{"type":"welcome","id":"<id>","peers":[{id,name,color,look}]}` | Your id and everyone already in the room. |
| `{"type":"peer-joined","peer":{id,name,color,look}}` | Someone arrived. |
| `{"type":"peer-left","id":"<id>"}` | Someone left. |
| `{"type":"signal","from":"<id>","data":{...}}` | A relayed setup message. |

Close codes: `4001` room full (12 people), `4002` no hello in time, `1009` bad message.

**Who makes the offer:** the newcomer. On `welcome`, they send an offer to every listed peer. People already in the room wait for offers. Because only the newcomer ever offers, two offers can never clash.

A room is a Durable Object that holds no stored data. It exists while sockets are connected and disappears when the last person leaves.

## 2. Peer links (WebRTC)

One `RTCPeerConnection` per pair of people (full mesh, so 12 people is 66 links). Two data channels are created on both sides with fixed ids, so nothing needs negotiating:

| Channel | Id | Settings | Payload |
|---|---|---|---|
| `state` | 0 | unordered, `maxRetransmits: 0` | `{"t":"p","x":123.4,"y":56.7,"s":42}` about 15 per second while moving, with `"r":"<building id>"` added when inside a building. `s` is a sequence number; older packets are dropped. Positions are world pixels outdoors and room pixels indoors. |
| `chat` | 1 | ordered, reliable | `{"t":"c","text":"hello"}` (max 200 characters). Sent only to people whose last reported place matches the sender's, so what is said inside a building is never sent to people outside. |

Voice and screen sharing use one audio and one video slot in each connection, created in the first offer, so switching the mic or a share on and off swaps a track (`replaceTrack`) and nothing is renegotiated.

| Reliable message | Meaning |
|---|---|
| `{"t":"s","on":true}` / `{"t":"s","on":false}` | Sent to people in the same building when someone starts or stops sharing their screen. `"full":true` means the viewer limit (6) was reached and this person will not get the picture. |

- **Voice:** your mic track is only handed to people who should hear you: within 360 px outdoors (with a 15% margin before it cuts out), or everyone in the same building. Far-away people cost no bandwidth. Volume falls off with distance and pans left or right.
- **Screen share:** the sharer sends one video stream to each viewer in the same building, at a bitrate that shrinks as viewers are added (about 3 Mbit/s shared between them).

Everything received from another person is validated before use (`app/src/net/protocol.ts`). Names and chat are shown with `textContent`, never as HTML.

## 3. ICE servers

`GET /ice` returns `{"iceServers":[...]}`: Cloudflare STUN always, plus Cloudflare TURN credentials when the Worker has the secrets `TURN_KEY_ID` and `TURN_API_TOKEN`. TURN is used only when a direct link cannot be made.

## Reliability

- **Broken connections heal.** If a link between two people fails (or stays "disconnected" for 8 seconds), the one who noticed sends `{"kind":"reset"}` through the server. Both drop the old link and the person with the lower id makes a fresh offer, so there is still only ever one offer. It retries up to 5 times with a growing pause (1, 2, 4, 8, 15 s) before showing "could not connect".
- **Dropped server connection.** The room counts it as you leaving, so everyone else closes their link to you. The page therefore reloads and rejoins by itself after a random 1 to 4 second pause, using your saved name, look and room code.
- **Rate limits.** The server closes a socket (code `1008`) that sends more than a burst of 600 messages or 60 a second on average. Between people, position updates are limited to 40 a second and chat to 3 a second, and any message over 4096 characters is ignored.
- **Click to walk.** A click or tap sets a walking target; the keyboard overrides it, and it is dropped if you get stuck against a wall.

## Known limits

- No TURN until the secrets are set. About one in ten networks block direct links, so test from a work network before relying on this.
- Reconnection is tested by breaking a link in the browser. A real network outage (Wi-Fi off and on) has not been tried.
- Privacy inside buildings is cooperative (see section 4), and there is no moderation, as requested.

## 4. The world

Nothing about the map is sent. Every client builds the town from the room code:

- `seed = fnv1a(roomCode)`; every square (32 x 32 tiles of 32 px) is generated from `mix(seed, cx, cy)` with integer-only maths (`app/src/world/`).
- Buildings have ids like `cx:cy:lot`. Interiors are generated from the seed and the building, so everyone gets the same room.
- A fingerprint test pins the output for known seeds. If generation ever changes, people on different versions would see different towns, so change it deliberately and bump the pinned values.
- Privacy inside buildings is cooperative, not cryptographic: your client chooses not to send chat to people outside. A modified client in the same room could still ask for it. This is a friendly meeting space, not a secure one.
