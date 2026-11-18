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
| `server/test/e2e/game.e2e.ts` | the real UI in Chrome: clicking through menu → lobby → game, sounds, animations, effects |

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

## Project layout

```
client/            Phaser game (Vite + TypeScript)
  src/scenes/      Menu, Lobby and Game scenes
  src/audio/       synthesised sound effects + music (no asset files)
  src/effects.ts   particles, confetti, button juice
  src/config.ts    server address
server/            Colyseus game server (Node + TypeScript)
  src/app.ts       HTTP + WebSocket server factory (lookup, /health, static client)
  src/physics.ts   shared platformer physics (pure functions)
  src/levels.ts    level data (platforms, crystals, exit, pits, spikes)
  src/rooms/       GameRoom: lobby, game loop, rules
  test/            unit, integration and browser tests
Dockerfile, render.yaml, .github/workflows/ci.yml
```

The server is authoritative: clients only send key state; the server simulates movement, collisions,
crystals and the exit, and broadcasts the result about 60 times a second.
