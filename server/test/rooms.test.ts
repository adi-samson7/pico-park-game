import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import type { App } from "../src/app.js";

import { EXIT_WIDTH, LEVELS, SPAWN_POSITIONS } from "../src/levels.js";

import { PHYSICS } from "../src/physics.js";

import {
  Bot,
  clientFor,
  createRoom,
  joinRoom,
  serverRoom,
  sleep,
  startApp,
  startGame,
  teleport,
  waitFor
} from "./helpers.js";

let app: App;

// Everything opened by a test is closed
// afterwards so tests stay independent.
let open: Bot[] = [];

const track = <T extends Bot>(bot: T): T => {
  open.push(bot);
  return bot;
};

before(async () => {
  app = await startApp();
});

afterEach(async () => {

  await Promise.all(open.map((b) => b.leave()));

  open = [];
});

after(async () => {
  await app.close();
});

/** A started game with `n` players. */
async function game(n = 1) {

  const host = track(await createRoom(app));

  const others: Bot[] = [];

  for (let i = 1; i < n; i++) {
    others.push(track(await joinRoom(app, host)));
  }

  await startGame(host, others);

  return { host, others, all: [host, ...others] };
}

// ==========================================
// LOBBY
// ==========================================

describe("lobby", () => {

  test("room codes are six unique uppercase alphanumerics", async () => {

    const hosts = await Promise.all(
      Array.from({ length: 8 }, async () => track(await createRoom(app)))
    );

    const codes = hosts.map((h) => h.roomCode);

    assert.equal(new Set(codes).size, 8);

    for (const code of codes) {
      assert.match(code, /^[A-Z0-9]{6}$/);
    }
  });

  test("a second player joins by room id and the first becomes host", async () => {

    const host = track(await createRoom(app));

    const guest = track(await joinRoom(app, host));

    await waitFor(() => host.count("playerJoined") === 1, "host sees guest");

    assert.equal(host.hostId, host.id);
    assert.equal(guest.hostId, host.id);
  });

  test("a fifth player is rejected: rooms hold four", async () => {

    const host = track(await createRoom(app));

    for (let i = 0; i < 3; i++) {
      track(await joinRoom(app, host));
    }

    await assert.rejects(clientFor(app).joinById(host.room.roomId));
  });

  test("only the host can start, and only when everyone is ready", async () => {

    const host = track(await createRoom(app));
    const guest = track(await joinRoom(app, host));

    guest.room.send("toggleReady");
    guest.room.send("startGame");

    await sleep(150);

    assert.equal(host.count("gameStarted"), 0, "a guest cannot start");

    host.room.send("startGame");

    await waitFor(() => host.last("startGameFailed"), "refusal");

    assert.equal(host.count("gameStarted"), 0, "host blocked until all ready");

    host.room.send("toggleReady");

    await waitFor(() => serverRoom(host).areAllPlayersReady(), "everyone ready");

    host.room.send("startGame");

    await waitFor(() => host.count("gameStarted") === 1, "game started");
  });

  test("the host role moves to the next player when the host leaves", async () => {

    const host = track(await createRoom(app));
    const second = track(await joinRoom(app, host));
    const third = track(await joinRoom(app, host));

    await host.leave();

    await waitFor(() => second.hostId === second.id && third.hostId === second.id, "new host");

    second.room.send("toggleReady");
    third.room.send("toggleReady");

    await waitFor(() => serverRoom(second).areAllPlayersReady(), "ready");

    second.room.send("startGame");

    await waitFor(() => second.count("gameStarted") === 1, "new host can start");
  });

  test("a game in progress is locked to newcomers", async () => {

    const { host } = await game(2);

    await assert.rejects(clientFor(app).joinById(host.room.roomId));
  });
});

// ==========================================
// PROTOCOL
// ==========================================

describe("protocol", () => {

  test("level geometry arrives once, the per-tick state stays small", async () => {

    const { host } = await game(2);

    const level = host.level!;

    assert.equal(level.level, 1);
    assert.equal(level.maxLevels, 3);
    assert.equal(level.crystals.length, LEVELS[0].crystals.length);
    assert.equal(level.platforms.length, LEVELS[0].platforms.length);
    assert.equal(level.exit.width, EXIT_WIDTH);
    assert.equal(level.doorOpen, false);
    assert.deepEqual(level.pits, LEVELS[0].pits);
    assert.deepEqual(level.spikes, LEVELS[0].spikes);

    const state = host.state as any;

    assert.ok(!("platforms" in state) && !("crystals" in state), "geometry is not re-sent every tick");
    assert.ok(JSON.stringify(state).length < 700, "state for 2 players stays small");

    for (const p of state.players) {
      assert.ok("jumpCount" in p && "grounded" in p);
    }
  });

  test("malformed input never crashes the room", async () => {

    const { host } = await game(2);

    const room = host.room as any;

    room.send("input", null);
    room.send("input", "garbage");
    room.send("input", 42);
    room.send("input", { left: "yes", right: 1, jump: "true" });

    await sleep(200);

    assert.ok(host.me, "still receiving state");
    assert.equal(host.me!.velocityX, 0, "non-boolean flags are ignored");
  });

  test("a client that stops sending input stops moving", async () => {

    const { host } = await game(1);

    await waitFor(() => host.me?.grounded, "grounded");

    host.stopInput();

    // left: walking right from the spawn ledge would drop onto the spikes
    host.room.send("input", { left: true });

    await sleep(100);

    const moving = host.me!.x;

    await sleep(700);

    const x1 = host.me!.x;

    await sleep(300);

    const x2 = host.me!.x;

    assert.ok(x1 < moving, "it moved while input was fresh");
    assert.equal(x1, x2, "and stopped once input went stale");
  });

  test("double jump: two jumps, never three", async () => {

    const { host } = await game(1);

    await waitFor(() => host.me?.grounded, "grounded");

    host.jump();

    await waitFor(() => host.me!.jumpCount === 1, "first jump");

    await sleep(200);

    host.jump();

    await waitFor(() => host.me!.jumpCount === 2, "second jump");

    await sleep(150);

    const before = host.me!.velocityY;

    host.jump();

    await sleep(60);

    assert.equal(host.me!.jumpCount, 2, "no third jump");
    assert.ok(host.me!.velocityY > before, "gravity keeps pulling: no new upward impulse");

    await waitFor(() => host.me!.grounded && host.me!.jumpCount === 0, "lands and resets", 8000);
  });

  test("players leaving mid-game do not disturb the others", async () => {

    const { host, others } = await game(3);

    await others[0].leave();

    await waitFor(() => host.state!.players.length === 2, "roster updated");

    assert.equal(host.count("playerLeft"), 1);
    assert.ok(host.me!.alive);
  });
});

// ==========================================
// HAZARDS
// ==========================================

describe("hazards", () => {

  test("touching spikes respawns the player at their spawn point", async () => {

    const { host } = await game(1);

    const strip = LEVELS[0].spikes[0];

    teleport(host, host, strip.x, strip.y - 30);

    const event = await waitFor(() => host.last("playerRespawned"), "respawn");

    assert.equal(event.cause, "spikes");
    assert.equal(event.id, host.id);
    assert.deepEqual([event.x, event.y], [SPAWN_POSITIONS[0].x, SPAWN_POSITIONS[0].y]);

    await waitFor(() => host.me!.grounded, "lands again");

    assert.equal(host.count("playerRespawned"), 1, "and does not die again");
  });

  test("falling out of the world respawns the player", async () => {

    const { host } = await game(1);

    const pit = LEVELS[0].pits[0];

    teleport(host, host, (pit.x1 + pit.x2) / 2, PHYSICS.KILL_Y - 5);

    const event = await waitFor(() => host.last("playerRespawned"), "respawn");

    assert.equal(event.cause, "fell");

    await waitFor(() => host.me!.grounded, "lands again");

    assert.equal(host.count("playerRespawned"), 1);
  });

  test("one player dying does not affect another", async () => {

    const { host, others } = await game(2);

    const strip = LEVELS[0].spikes[0];

    teleport(host, others[0], strip.x, strip.y - 30);

    await waitFor(() => others[0].last("playerRespawned"), "respawn");

    assert.equal(host.last("playerRespawned").id, others[0].id);

    await sleep(100);

    assert.ok(host.me!.alive);
  });
});

// ==========================================
// CRYSTALS, EXIT DOOR, PROGRESSION
// ==========================================

const isCollected = (host: Bot, id: number) =>
  serverRoom(host).crystals.get(id).collected as boolean;

/** Moves a player onto a crystal and waits for the
 *  server's event about THAT crystal (others may be
 *  picked up at the same moment by players dropping in).
 *
 *  Crystal ids restart at 0 in every level, so only
 *  events received AFTER the teleport may count. */
async function collect(host: Bot, who: Bot, crystal: { id: number; x: number; y: number }) {

  const from = host.events.length;

  teleport(host, who, crystal.x, crystal.y);

  return waitFor(
    () =>
      host.events
        .slice(from)
        .find((e) => e.type === "crystalCollected" && e.data.id === crystal.id),
    `crystal ${crystal.id} collected`
  );
}

/** Everyone has landed, so the pickups that happen
 *  while dropping in onto the first platform are done. */
const settled = (bots: Bot[]) =>
  waitFor(() => bots.every((b) => b.me?.grounded), "players settled", 8000);

/** Collects every remaining crystal through the real
 *  collection code. */
async function collectAll(host: Bot, collector: Bot, everyone: Bot[] = [host]) {

  await settled(everyone);

  await sleep(100);

  for (const crystal of host.level!.crystals) {

    if (!isCollected(host, crystal.id)) {
      await collect(host, collector, crystal);
    }
  }
}

describe("crystals and the exit door", () => {

  test("collecting counts for everyone, and the last crystal opens the door", async () => {

    const { host, others } = await game(2);

    const level = host.level!;

    assert.equal(host.state!.doorOpen, false);

    // Spawning on the first platform already picks up a few crystals.
    await settled([host, ...others]);

    await sleep(100);

    let score = serverRoom(host).score as number;

    assert.ok(score < level.crystals.length);

    let n = 0;

    // alternate collectors: the score is shared
    for (const crystal of level.crystals) {

      if (isCollected(host, crystal.id)) {
        continue;
      }

      const who = n++ % 2 === 0 ? host : others[0];

      const event = await collect(host, who, crystal);

      score++;

      assert.equal(event.data.score, score, "one shared score");

      if (score < level.crystals.length) {
        assert.equal(host.count("doorOpened"), 0, "door stays shut until the last crystal");
      }
    }

    assert.equal(score, level.crystals.length);

    await waitFor(() => host.count("doorOpened") === 1, "door opens");

    assert.equal(host.count("levelCompleted"), 0, "collecting alone does not finish the level");

    await waitFor(() => host.state!.doorOpen, "door open in state");
  });

  test("the level needs EVERY player in the door", async () => {

    const { host, others } = await game(2);

    await collectAll(host, host, [host, others[0]]);

    await waitFor(() => host.state!.doorOpen, "door open");

    const exit = host.level!.exit;

    // one player in the door, the other elsewhere
    teleport(host, host, exit.x, exit.y);

    await waitFor(() => host.state!.playersAtExit === 1, "one at the exit");

    await sleep(300);

    assert.equal(host.count("levelCompleted"), 0, "must not complete with one of two inside");

    // the second joins: complete
    teleport(host, others[0], exit.x + 40, exit.y);

    await waitFor(() => host.count("levelCompleted") === 1, "level completes");

    assert.deepEqual(
      { from: host.last("levelCompleted").completedLevel, to: host.last("levelCompleted").nextLevel },
      { from: 1, to: 2 }
    );
  });

  test("a closed door does not complete the level", async () => {

    const { host } = await game(1);

    const exit = host.level!.exit;

    teleport(host, host, exit.x, exit.y);

    await sleep(400);

    assert.equal(host.count("levelCompleted"), 0);
    assert.equal(host.state!.playersAtExit, 1);
  });

  test("a disconnecting player stops blocking the exit", async () => {

    const { host, others } = await game(2);

    await collectAll(host, host);

    await waitFor(() => host.state!.doorOpen, "door open");

    const exit = host.level!.exit;

    teleport(host, host, exit.x, exit.y);

    await sleep(250);

    assert.equal(host.count("levelCompleted"), 0);

    await others[0].leave();

    await waitFor(() => host.count("levelCompleted") === 1, "level completes without the leaver");
  });

  test("clearing all three levels ends the game and resets between levels", async () => {

    const { host, others } = await game(2);

    for (let level = 1; level <= 3; level++) {

      await waitFor(() => host.level!.level === level, `level ${level} loaded`);

      if (level > 1) {

        assert.equal(host.level!.score, 0, "score resets for each level");
        assert.ok(host.level!.crystals.every((c) => !c.collected), "all crystals are back");
      }

      assert.equal(host.level!.crystals.length, LEVELS[level - 1].crystals.length);

      await collectAll(host, host, [host, others[0]]);

      await waitFor(() => host.state!.doorOpen, "door open");

      const exit = host.level!.exit;

      teleport(host, host, exit.x - 30, exit.y);
      teleport(host, others[0], exit.x + 30, exit.y);

      if (level < 3) {

        await waitFor(() => host.count("levelCompleted") === level, `level ${level} complete`);

        // players are sent back to their spawns
        await waitFor(() => host.level!.level === level + 1, "next level");

        const mine = serverRoom(host).players.get(host.id);

        assert.ok(mine.y < 400, "back near the spawn height");

        assert.equal(host.last("levelLoaded").doorOpen, false, "door is closed again");
      }
    }

    await waitFor(() => host.count("gameFinished") === 1, "game finished");

    assert.equal(host.last("gameFinished").result, "win");
    assert.equal(host.count("levelCompleted"), 2, "the last level ends the game instead");
  });
});
