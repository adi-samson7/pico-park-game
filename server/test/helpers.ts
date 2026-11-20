import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { matchMaker } from "colyseus";

import { createApp, type App } from "../src/app.js";

// Keep test output readable.
process.env.LOG_LEVEL = "silent";

// "LEVEL N" / "LEVEL CLEAR" last 3 s in the game. Tests that are not about
// those screens should not wait for them: tests that are set their own.
process.env.LEVEL_CLEAR_SECONDS ??= "0.05";
process.env.LEVEL_INTRO_SECONDS ??= "0.05";

// ==========================================
// TIMING
// ==========================================

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `fn` is truthy; throws on timeout. */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  what: string,
  timeoutMs = 5000,
  stepMs = 15
): Promise<NonNullable<T>> {

  const end = Date.now() + timeoutMs;

  for (;;) {

    const value = await fn();

    if (value) {
      return value as NonNullable<T>;
    }

    if (Date.now() > end) {
      throw new Error(`Timed out waiting for: ${what}`);
    }

    await sleep(stepMs);
  }
}

// ==========================================
// APP
// ==========================================

/** Starts a quiet server on a free port. */
export function startApp(
  extra: { staticDir?: string } = {}
): Promise<App> {

  return createApp({
    port: 0,
    host: "127.0.0.1",
    greet: false,
    handleSignals: false,
    ...extra
  });
}

// ==========================================
// BOT
// ==========================================

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  playerIndex: number;
  name?: string;
  color?: number;
  alive: boolean;
  jumpCount: number;
  grounded: boolean;
  standingOn?: string | null;
  connected?: boolean;
  ack?: number;
}

export interface GameState {
  players: PlayerState[];
  score: number;
  targetScore: number;
  level: number;
  maxLevels: number;
  gameStarted: boolean;
  gameFinished: boolean;
  doorOpen: boolean;
  playersAtExit: number;
  playersNeeded?: number;
  phase?: "intro" | "playing" | "clear";
  phaseMsLeft?: number;
  levelElapsedMs?: number;
}

export interface LevelPayload {
  level: number;
  maxLevels: number;
  targetScore: number;
  score: number;
  platforms: unknown[];
  crystals: { id: number; x: number; y: number; collected: boolean }[];
  exit: { x: number; y: number; width: number; height: number };
  doorOpen: boolean;
  pits: { x1: number; x2: number }[];
  spikes: { x: number; y: number; width: number }[];
  spikeHeight: number;
}

const MESSAGES = [
  "gameState",
  "levelLoaded",
  "roomCode",
  "playerJoinedSelf",
  "playerJoined",
  "playerLeft",
  "playerReadyChanged",
  "playerProfileChanged",
  "allPlayersReady",
  "hostChanged",
  "gameStarted",
  "crystalCollected",
  "doorOpened",
  "levelCompleted",
  "levelIntro",
  "levelStarted",
  "lobbyReopened",
  "gameFinished",
  "playerRespawned",
  "startGameFailed",
  "playerDropped",
  "playerReconnected",
  "resync",
  "latencies"
] as const;

/** A scripted player that records what the
 *  server sends it. */
export class Bot {

  state: GameState | null = null;

  level: LevelPayload | null = null;

  hostId = "";

  roomCode = "";

  // Every message, in order.
  // `at` is when it arrived (ms since the epoch).
  events: { type: string; data: any; at: number }[] = [];

  input: Record<string, unknown> = {};

  private timer: NodeJS.Timeout | null = null;

  // Connection life cycle as the client
  // library reports it.
  drops = 0;

  reconnects = 0;

  // Set when the library gave up (or we left).
  leftWith: number | null = null;

  constructor(readonly room: ClientRoom) {

    // Swallow anything we don't list so the
    // SDK doesn't log warnings.
    room.onMessage("*", () => {});

    room.onDrop(() => { this.drops++; });
    room.onReconnect(() => { this.reconnects++; });
    room.onLeave((code) => { this.leftWith = code; });

    // Retry straight away, even if the room
    // was joined a moment ago.
    room.reconnection.minUptime = 0;
    room.reconnection.delay = 50;

    for (const type of MESSAGES) {

      room.onMessage(type, (data: any) => {

        this.events.push({ type, data, at: Date.now() });

        if (type === "gameState") {
          this.state = data;
        } else if (type === "levelLoaded") {
          this.level = data;
        } else if (type === "hostChanged") {
          this.hostId = data.id;
        } else if (type === "roomCode") {
          this.roomCode = data.roomCode;
        }
      });
    }
  }

  get id() {
    return this.room.sessionId;
  }

  get me(): PlayerState | undefined {
    return this.state?.players.find((p) => p.id === this.id);
  }

  count(type: string) {
    return this.events.filter((e) => e.type === type).length;
  }

  last(type: string) {
    return [...this.events].reverse().find((e) => e.type === type)?.data;
  }

  /** Send the held input every frame, like the
   *  real client does. */
  startInput(everyMs = 16) {

    this.stopInput();

    this.timer = setInterval(
      () => this.room.send("input", { ...this.input }),
      everyMs
    );
  }

  stopInput() {

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  jump() {
    this.room.send("input", { ...this.input, jump: true });
  }

  /** Cuts the connection like a network
   *  failure would (the SDK's own "offline"
   *  path: the server sees a non-consented
   *  close). The library then retries. */
  drop() {

    this.room.connection.close(4010);
  }

  private leaving: Promise<void> | null = null;

  /** Safe to call any number of times: the SDK's
   *  second leave() on a closed room never
   *  resolves, so only the first call does work,
   *  and it is bounded. */
  leave(): Promise<void> {

    this.stopInput();

    this.leaving ??= (async () => {

      try {
        await Promise.race([this.room.leave(), sleep(2000)]);
      } catch {
        // already closed
      }
    })();

    return this.leaving;
  }
}

export function clientFor(app: App) {
  return new Client(`ws://127.0.0.1:${app.port}`);
}

/** Creates a room and returns its bot. */
export async function createRoom(
  app: App,
  options: Record<string, unknown> = {}
): Promise<Bot> {

  const bot = new Bot(await clientFor(app).create("game", options));

  await waitFor(() => bot.roomCode, "room code");

  return bot;
}

export async function joinRoom(
  app: App,
  host: Bot,
  options: Record<string, unknown> = {}
): Promise<Bot> {

  const bot = new Bot(await clientFor(app).joinById(host.room.roomId, options));

  await waitFor(() => bot.hostId, "host info");

  return bot;
}

// ==========================================
// IN-PROCESS ACCESS
// ==========================================

/** The live GameRoom behind a bot, for
 *  deterministic setups (teleporting players,
 *  inspecting state). */
export function serverRoom(bot: Bot): any {

  return matchMaker.getLocalRoomById(bot.room.roomId);
}

/** Readies everyone, starts the game and waits
 *  until the level geometry has arrived. */
export async function startGame(host: Bot, others: Bot[] = []) {

  for (const bot of [host, ...others]) {
    bot.room.send("toggleReady");
  }

  await waitFor(
    () => serverRoom(host).areAllPlayersReady(),
    "everyone ready"
  );

  host.room.send("startGame");

  await waitFor(() => host.count("gameStarted") > 0, "game start");

  for (const bot of [host, ...others]) {
    bot.room.send("requestLevel");
    bot.startInput();
  }

  await waitFor(
    () => [host, ...others].every((b) => b.level && b.me),
    "level + state"
  );

  // The "LEVEL 1" screen is over and the level is being played.
  await waitFor(
    () => serverRoom(host).phase === "playing",
    "the level intro to end"
  );
}

/** Moves a player straight to a position. */
export function teleport(
  host: Bot,
  who: Bot,
  x: number,
  y: number
) {

  const player = serverRoom(host).players.get(who.id);

  player.x = x;
  player.y = y;
  player.velocityX = 0;
  player.velocityY = 0;
  player.standingOn = null;
}
