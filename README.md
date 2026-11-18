# Pico Co-op

A browser-based, real-time multiplayer **co-op platformer** for 1–4 players, inspired by Pico Park.
Players share a room, jump (and double jump), stack on each other's heads, avoid spikes and pits,
collect shared crystals and all reach the exit door to clear three levels.

Built with **Phaser 3** (client), **Colyseus** + **Node.js** (server), **TypeScript** and **Vite**.

## Play it

| Key | Action |
| --- | --- |
| `A` / `D` or `←` / `→` | Move |
| `Space` (or `↑` / `W`) | Jump; press again in the air to double jump |
| `M` | Mute / unmute |

1. One player clicks **Create Room** and shares the 6-character room code.
2. Others click **Join Room** and enter it.
3. Everyone clicks **Ready**; the host clicks **Start Game**.
4. Collect every crystal to unlock the exit, then get **every** player inside the door.

## Run it locally

Requires **Node 22+**.

```bash
npm run install:all      # installs client/ and server/
npm run dev:server       # terminal 1: game server on http://localhost:2567
npm run dev:client       # terminal 2: client on http://localhost:5173
```

Open <http://localhost:5173> in two browser tabs to play against yourself.

### Production build (one process, one port)

```bash
npm run build            # builds client/dist and server/dist
npm start                # serves the game, the API and the client on :2567
```

Open <http://localhost:2567>.

## Tests

```bash
npm test                 # unit + integration tests (about 20 s)
npm run test:e2e         # headless-Chrome end-to-end tests against the production build
npm run typecheck
```

| Suite | What it covers |
| --- | --- |
| `server/test/physics.test.ts` | double jump, stacking (carry, stacks of three, slow ticks), one-way platforms, pits, spikes |
| `server/test/levels.test.ts` | level data sanity, safe spawns, an exhaustive search proving every crystal and exit is reachable **alive**, hazards are lethal, four players fit in each door |
| `server/test/registry.test.ts` | room code registry |
| `server/test/app.test.ts` | `/health`, room lookup, CORS, static client serving, cache headers |
| `server/test/rooms.test.ts` | lobby rules, host migration, room locking, input validation, hazards, crystals → door → next level → win |
| `server/test/reconnect.test.ts` | dropped connections: the seat is held, the player comes back with a full resync, host hand-over, the exit never waits for an absent player, input sequence numbers, latency reports |
| `server/test/netcode.test.ts` | interpolation, prediction and reconciliation run against the real server physics over simulated latency and jitter (10 ms to 400 ms, 30 to 144 fps, stacking on a player's head), ping bands, session storage |
| `server/test/physics-sync.test.ts` | the client's copy of the physics is identical to the server's |
| `server/test/e2e/game.e2e.ts` | the real UI in Chrome: clicking through menu → lobby → game, sounds, animations, effects |
| `server/test/e2e/net.e2e.ts` | Chrome playing through a lag proxy: ping chip, prediction vs. a 300 ms round trip, smooth remote players, outages, reload-and-resume, giving up, stale sessions |
| `server/test/e2e/hosting.e2e.ts` | the client built for another origin (static host) talking to the game server: CORS, WebSocket, joining by code, resume |

The e2e suite needs `npm run build` first and Chrome/Chromium (set `CHROME_PATH` if it is not found;
`E2E_SCREENSHOTS=<dir>` saves a screenshot per stage). It skips, with a reason, when it cannot run.
CI runs everything on every push (`.github/workflows/ci.yml`).

## Configuration

Server environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `2567` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `CLIENT_DIST` | `../../client/dist` | Directory of the built client to serve |
| `CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for the room lookup endpoint |
| `LOG_LEVEL` | (info) | `silent` turns off the game log |
| `RECONNECT_WINDOW_SECONDS` | `30` | How long a player whose connection dropped keeps their seat (see [Bad connections](#bad-connections)) |

Client build-time variable:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_SERVER_URL` | dev: `http://localhost:2567`, production: same origin | Where the game server is. Only needed if it is on a different domain than the page. The client uses `wss://` automatically for `https://` pages. |

## Deploy

### Docker

```bash
docker build -t pico-coop .
docker run --rm -p 2567:2567 pico-coop       # http://localhost:2567
```

The image is multi-stage, runs as a non-root user, listens on `$PORT` and has a `HEALTHCHECK` on `/health`.

### Render (or any Docker host)

`render.yaml` is a ready-made blueprint: create a new **Blueprint** from this repository and Render builds the
`Dockerfile`, health-checks `/health`, provides HTTPS and WebSocket support, and sets `PORT`.
Any host that runs a container and supports WebSockets (Fly.io, Railway, a VPS behind a TLS proxy) works the same way.

### Important: run a single instance

Rooms and room codes live **in the server's memory**. Consequences:

- **Do not scale horizontally.** A second instance would not know the first instance's rooms, so some players
  could not join. Keep `numInstances: 1` (one instance comfortably handles many rooms).
- Restarting or redeploying the server **ends all running games**.
- Free-tier hosts that sleep when idle will drop rooms when they sleep.

Going beyond that needs a shared room registry and Colyseus' Redis presence/driver (see the PRD's risk list).

## Bad connections

The server is authoritative, so a laggy or flaky connection must not make the game feel laggy or flaky.

| Problem | What the game does |
| --- | --- |
| **Your own movement feels late** | *Client-side prediction*: the client runs the same physics code as the server (`client/src/shared/physics.ts` is a checked-in copy of `server/src/physics.ts`) on your player right away. Every input carries a sequence number and every server state says which one it has applied; if the prediction was wrong (bumped, respawned, a guess about another player) the client takes the server's state, replays the inputs the server has not seen yet and glides the picture to the corrected spot. |
| **Other players stutter** | *Snapshot interpolation*: other players are drawn 50 ms in the past, between two positions that have already arrived, so late packets do not show. |
| **The connection drops** (Wi-Fi blip, closed laptop, **page reload**) | The server keeps the player's seat for 30 s. The client library retries on its own, the screen shows "CONNECTION LOST", other players see the character greyed out, and the returning player gets a full *resync* (roster, level, crystals, door) and is put back at their spawn point. A reload resumes the game too: the tab remembers the room in `sessionStorage`. While someone is away the door does not wait for them and nobody can stand on them. If they do not return in time they are removed like a normal leave. |
| **Who has a bad connection?** | A ping chip (bottom right) and a ping under every player's colour chip, green below 80 ms, yellow below 160 ms, red above. |

Leaving on purpose (LEAVE, or ENTER after winning) is never held: it frees the seat immediately.

Switches for comparing and testing (append to the URL):

| URL | Effect |
| --- | --- |
| `?predict=0` | no prediction: the local player is drawn from the server only |
| `?interp=0` / `?interp=150` | draw other players at their latest position / 150 ms in the past |
| `?retries=3` | give up on a lost connection after 3 attempts instead of 10 |

If you change `server/src/physics.ts`, run `npm run sync:physics`: a test and `npm run typecheck` fail while the client's copy is out of date.

## Hosting the client on Vercel / Firebase Hosting / Netlify

A static host can serve the built client (`client/dist`), but **not the game server**: Vercel and Firebase Functions are serverless and cannot keep a WebSocket open. Run the game server on something that can (Render with the included `render.yaml`, Fly.io, Railway, Google Cloud Run, a VPS) and point the client at it:

1. Deploy the server (single instance, see below) and note its URL, e.g. `https://pico-server.onrender.com`.
2. Build the client with `VITE_SERVER_URL=https://pico-server.onrender.com`. On Vercel set it as an Environment Variable (Root Directory `client`, build command `npm run build`, output `dist`); with Firebase, `VITE_SERVER_URL=... npm --prefix client run build` and deploy `client/dist` as the hosting `public` directory.
3. The client uses `wss://` automatically for an `https://` server. The server accepts requests from other origins by default; set `CORS_ORIGIN=https://your-site.vercel.app` to restrict the room-code lookup.

`server/test/e2e/hosting.e2e.ts` runs exactly this split (built client on one origin, game server on another) in a real browser.

## Project layout

```
client/            Phaser game (Vite + TypeScript)
  src/scenes/      Menu, Lobby and Game scenes
  src/audio/       synthesised sound effects + music (no asset files)
  src/net/         prediction, interpolation, ping, session resume, connection overlay
  src/shared/      copy of the server's physics (see "Bad connections")
  src/effects.ts   particles, confetti, button juice
  src/config.ts    server address
server/            Colyseus game server (Node + TypeScript)
  src/app.ts       HTTP + WebSocket server factory (lookup, /health, static client)
  src/physics.ts   platformer physics (pure functions; the client keeps a copy)
  src/levels.ts    level data (platforms, crystals, exit, pits, spikes)
  src/rooms/       GameRoom: lobby, game loop, rules
  test/            unit, integration and browser tests
Dockerfile, render.yaml, .github/workflows/ci.yml
```

The server is authoritative: clients only send key state; the server simulates movement, collisions,
crystals and the exit, and broadcasts the result about 60 times a second.
