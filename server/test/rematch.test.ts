import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import type { App } from "../src/app.js";

import { LEVELS, SPAWN_POSITIONS } from "../src/levels.js";

import {
  Bot,
  createRoom,
  joinRoom,
  serverRoom,
  sleep,
  startApp,
  teleport,
  waitFor
} from "./helpers.js";

// After the last level the room is a lobby again, so the same group can play
// another round without creating a new room.

let app: App;

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

const playing = (host: Bot) =>
  waitFor(() => serverRoom(host).phase === "playing", "the level to be playing", 8000);

/** Collects every crystal and puts everyone into the door. */
async function finishLevel(host: Bot, everyone: Bot[]) {

  const room = serverRoom(host);

  await sleep(100);

  for (const crystal of room.crystals.values()) {

    if (crystal.collected) {
      continue;
    }

    teleport(host, host, crystal.x, crystal.y);

    await waitFor(() => room.crystals.get(crystal.id).collected, `crystal ${crystal.id}`);
  }

  await waitFor(() => room.doorOpen, "door open");

  everyone.forEach((bot, i) =>
    teleport(host, bot, room.exit.x + (i % 2 ? 30 : -30), room.exit.y)
  );
}

/** Lobby with `n` players, everyone ready, game started. */
async function startRound(host: Bot, everyone: Bot[]) {

  for (const bot of everyone) {

    if (!serverRoom(host).players.get(bot.id).ready) {
      bot.room.send("toggleReady");
    }
  }

  await waitFor(() => serverRoom(host).areAllPlayersReady(), "everyone ready");

  host.room.send("startGame");
}

/** Plays all three levels to the end and waits for the win. */
async function winGame(host: Bot, everyone: Bot[]) {

  for (let level = 1; level <= 3; level++) {

    await waitFor(
      () => host.state?.level === level && serverRoom(host).phase === "playing",
      `level ${level} playing`,
      6000
    );

    await finishLevel(host, everyone);

    await waitFor(() => host.count("levelCompleted") === level, `level ${level} cleared`);
  }
}

/** A room whose first game has just been won. */
async function afterAWin(n = 2) {

  const host = track(await createRoom(app));

  const others: Bot[] = [];

  for (let i = 1; i < n; i++) {
    others.push(track(await joinRoom(app, host)));
  }

  const all = [host, ...others];

  await startRound(host, all);

  await waitFor(() => host.count("gameStarted") === 1, "first game starts");

  for (const bot of all) {
    bot.room.send("requestLevel");
    bot.startInput();
  }

  await winGame(host, all);

  await waitFor(() => host.count("gameFinished") === 1, "the win", 4000);

  return { host, others, all };
}

describe("after the last level", () => {

  test("the room is a lobby again: nobody is ready, newcomers can join", async () => {

    const { host, others, all } = await afterAWin(2);

    const room = serverRoom(host);

    assert.equal(room.gameStarted, false);
    assert.equal(room.gameFinished, false, "not stuck in a finished state");
    assert.equal(room.locked, false, "open to newcomers again");

    for (const bot of all) {
      assert.equal(room.players.get(bot.id).ready, false, "everyone has to ready up again");
    }

    // ...and everybody was told
    await waitFor(
      () => host.events.filter((e) => e.type === "playerReadyChanged" && e.data.ready === false).length >= 2,
      "ready states reset in the lobby"
    );

    await waitFor(() => host.count("lobbyReopened") === 1, "lobby reopened");

    // The picture a client gets when it asks (or comes back after a drop).
    others[0].room.send("requestResync");

    const resync = await waitFor(() => others[0].last("resync"), "resync");

    assert.equal(resync.gameStarted, false);
    assert.equal(resync.gameFinished, false);
    assert.equal(resync.level, null, "no level: this is a lobby");
    assert.equal(resync.hostId, host.id, "the host stays the host");
    assert.equal(resync.players.length, 2);

    // A third player can now join the same room.
    const third = track(await joinRoom(app, host));

    await waitFor(() => host.count("playerJoined") >= 2, "host sees the newcomer");

    assert.equal(serverRoom(host).players.size, 3);

    assert.equal(third.hostId, host.id);
  });

  test("a new game can be started from there, needing everybody to ready up first", async () => {

    const { host, others, all } = await afterAWin(2);

    host.room.send("startGame");

    await waitFor(() => host.last("startGameFailed"), "refused: nobody is ready");

    assert.equal(host.count("gameStarted"), 1, "no second game yet");

    // only the host readies: still not enough
    host.room.send("toggleReady");

    await waitFor(() => serverRoom(host).players.get(host.id).ready, "host ready");

    host.room.send("startGame");

    await sleep(150);

    assert.equal(host.count("gameStarted"), 1, "the guest has not readied up");

    others[0].room.send("toggleReady");

    await waitFor(() => serverRoom(host).areAllPlayersReady(), "everyone ready");

    host.room.send("startGame");

    await waitFor(() => host.count("gameStarted") === 2, "second game starts");

    // ---- a clean first level ----

    for (const bot of all) {
      bot.room.send("requestLevel");
    }

    await waitFor(() => host.level?.level === 1 && host.state?.level === 1, "level 1 again");

    const level = host.level!;

    assert.equal(level.score, 0, "score starts again");
    assert.equal(level.doorOpen, false);
    assert.equal(level.crystals.length, LEVELS[0].crystals.length);
    assert.ok(level.crystals.every((c) => !c.collected), "every crystal is back");

    assert.equal(host.count("levelIntro"), 4, "the LEVEL 1 screen is shown again");
    assert.equal(host.last("levelIntro").level, 1);

    assert.deepEqual(
      { x: serverRoom(host).players.get(host.id).x, y: serverRoom(host).players.get(host.id).y },
      { x: SPAWN_POSITIONS[0].x, y: SPAWN_POSITIONS[0].y },
      "back at the spawn point"
    );

    // ---- and it plays like the first one ----

    await playing(host);

    const cleared = host.count("levelCompleted");

    await finishLevel(host, all);

    await waitFor(() => host.count("levelCompleted") === cleared + 1, "level 1 can be cleared again");

    assert.equal(host.last("levelCompleted").completedLevel, 1);

    await waitFor(() => host.count("levelIntro") === 5, "then LEVEL 2");
  });

  test("someone who left after the win does not stop the others playing again", async () => {

    const { host, others } = await afterAWin(2);

    await others[0].leave();

    await waitFor(() => serverRoom(host).players.size === 1, "guest gone");

    await startRound(host, [host]);

    await waitFor(() => host.count("gameStarted") === 2, "the host starts another round alone");

    await waitFor(() => host.level?.level === 1, "level 1");
  });

  test("a newcomer can play the next round with the old players", async () => {

    const { host, others } = await afterAWin(2);

    const third = track(await joinRoom(app, host));

    const all = [host, ...others, third];

    await startRound(host, all);

    await waitFor(() => host.count("gameStarted") === 2, "round two with three players");

    for (const bot of all) {
      bot.room.send("requestLevel");
      bot.startInput();
    }

    await waitFor(() => all.every((b) => b.me), "everyone in the game");

    assert.equal(host.state!.players.length, 3);

    await playing(host);

    await finishLevel(host, all);

    await waitFor(() => host.count("levelCompleted") === 4, "three players clear level 1");
  });

  test("the room can be won again and again", async () => {

    const { host, others, all } = await afterAWin(2);

    for (let round = 2; round <= 3; round++) {

      await startRound(host, all);

      await waitFor(() => host.count("gameStarted") === round, `round ${round} starts`);

      for (const bot of all) {
        bot.room.send("requestLevel");
      }

      const before = host.count("levelCompleted");

      for (let level = 1; level <= 3; level++) {

        await waitFor(
          () => host.state?.level === level && serverRoom(host).phase === "playing",
          `round ${round} level ${level}`,
          6000
        );

        await finishLevel(host, all);

        await waitFor(() => host.count("levelCompleted") === before + level, `cleared ${level}`);
      }

      await waitFor(() => host.count("gameFinished") === round, `round ${round} won`, 4000);

      assert.equal(serverRoom(host).gameStarted, false);
      assert.equal(serverRoom(host).locked, false);
    }

    assert.equal(others.length, 1);
  });
});
