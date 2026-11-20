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

// "LEVEL N" before a level and "LEVEL CLEAR" after it: a few seconds in which
// nobody can move, and after which the level (and its timer) starts. The
// durations are 3 s in the game; tests that look at the timing use others.

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

  process.env.LEVEL_CLEAR_SECONDS = "0.05";
  process.env.LEVEL_INTRO_SECONDS = "0.05";

  delete process.env.RECONNECT_WINDOW_SECONDS;

  await Promise.all(open.map((b) => b.leave()));

  open = [];
});

after(async () => {
  await app.close();
});

const setDurations = (clear: number, intro: number) => {
  process.env.LEVEL_CLEAR_SECONDS = String(clear);
  process.env.LEVEL_INTRO_SECONDS = String(intro);
};

/** Everyone ready, game started; returns as soon as the first state arrived
 *  (during the "LEVEL 1" screen). */
async function begin(n = 1) {

  const host = track(await createRoom(app));

  const others: Bot[] = [];

  for (let i = 1; i < n; i++) {
    others.push(track(await joinRoom(app, host)));
  }

  const all = [host, ...others];

  for (const bot of all) {
    bot.room.send("toggleReady");
  }

  await waitFor(() => serverRoom(host).areAllPlayersReady(), "everyone ready");

  host.room.send("startGame");

  await waitFor(() => host.count("gameStarted") > 0, "game start");

  for (const bot of all) {
    bot.room.send("requestLevel");
    bot.startInput();
  }

  await waitFor(() => all.every((b) => b.level && b.me), "level + state");

  return { host, others, all };
}

const playing = (host: Bot) =>
  waitFor(() => serverRoom(host).phase === "playing", "the level to be playing", 8000);

const event = (bot: Bot, type: string, from = 0) =>
  bot.events.slice(from).find((e) => e.type === type);

/** Collects every crystal through the real collection code and puts
 *  everybody into the door. */
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

  const exit = room.exit;

  everyone.forEach((bot, i) =>
    teleport(host, bot, exit.x + (i % 2 ? 30 : -30), exit.y)
  );
}

const position = (host: Bot, bot: Bot) => {

  const p = serverRoom(host).players.get(bot.id);

  return { x: p.x, y: p.y };
};

// ==========================================
// "LEVEL 1" BEFORE THE FIRST LEVEL
// ==========================================

describe("the screen before a level", () => {

  test("the game starts with a LEVEL 1 screen: nobody can move and no timer runs", async () => {

    setDurations(0.05, 0.9);

    const { host, others } = await begin(2);

    const intro = event(host, "levelIntro")!;

    assert.deepEqual(
      { level: intro.data.level, maxLevels: intro.data.maxLevels, introMs: intro.data.introMs },
      { level: 1, maxLevels: 3, introMs: 900 }
    );

    assert.equal(host.state!.phase, "intro");
    assert.ok(host.state!.phaseMsLeft! > 0 && host.state!.phaseMsLeft! <= 900);
    assert.equal(host.state!.levelElapsedMs, 0, "the timer has not started");

    const before = position(host, host);

    assert.deepEqual(before, { x: SPAWN_POSITIONS[0].x, y: SPAWN_POSITIONS[0].y }, "held at the spawn point");

    // Everybody pushes every button for a while.
    for (const bot of [host, ...others]) {
      bot.input = { left: true, jump: true };
    }

    await sleep(350);

    assert.deepEqual(position(host, host), before, "did not move (no walking, jumping or falling)");
    assert.deepEqual(position(host, others[0]), { x: SPAWN_POSITIONS[1].x, y: SPAWN_POSITIONS[1].y });

    assert.equal(host.state!.phase, "intro");

    assert.equal(host.state!.levelElapsedMs, 0, "still no timer well into the screen");

    // Let go of everything before the screen ends: what was pressed during
    // it must not be saved up and fired when play starts.
    for (const bot of [host, ...others]) {
      bot.input = {};
    }

    // Then the level starts.
    await waitFor(() => event(host, "levelStarted"), "the level starts", 3000);

    assert.equal(event(host, "levelStarted")!.data.level, 1);

    // Input sent during the screen was thrown away, not saved up: the
    // players just start falling.
    await waitFor(() => host.state!.phase === "playing", "playing");

    assert.ok(host.me!.velocityY >= 0, "no jump left over from the held buttons");

    for (const bot of [host, ...others]) {
      bot.input = { right: true };
    }

    const x = host.me!.x;

    await waitFor(() => host.me!.x > x + 20, "the player moves once the level has started");
  });

  test("the screen lasts as long as announced, then play starts", async () => {

    setDurations(0.05, 0.7);

    const { host } = await begin(1);

    const loaded = event(host, "levelLoaded")!;

    const started = await waitFor(() => event(host, "levelStarted"), "level started", 3000);

    const waited = started.at - loaded.at;

    assert.ok(waited >= 640 && waited < 1100, `waited ${waited} ms for a 700 ms screen`);
  });

  test("the level timer starts when play starts, not before", async () => {

    setDurations(0.05, 0.6);

    const { host } = await begin(1);

    assert.equal(host.state!.levelElapsedMs, 0);

    await playing(host);

    await sleep(300);

    const elapsed = host.state!.levelElapsedMs!;

    assert.ok(elapsed >= 200 && elapsed < 700, `${elapsed} ms after the start of play`);
  });

  test("by default both screens last three seconds", async () => {

    // Neither variable set: the real defaults.
    delete process.env.LEVEL_CLEAR_SECONDS;
    delete process.env.LEVEL_INTRO_SECONDS;

    const { host, others } = await begin(2);

    assert.equal(event(host, "levelIntro")!.data.introMs, 3000);

    // Skip the three seconds of waiting: end the intro by hand.
    serverRoom(host).beginPlaying();

    await finishLevel(host, [host, others[0]]);

    await waitFor(() => event(host, "levelCompleted"), "level complete");

    assert.equal(event(host, "levelCompleted")!.data.clearMs, 3000);
  });
});

// ==========================================
// "LEVEL CLEAR" AND THE NEXT LEVEL
// ==========================================

describe("the screens between levels", () => {

  test("LEVEL CLEAR freezes everyone, then the next level loads with its own LEVEL screen", async () => {

    setDurations(0.7, 0.8);

    const { host, others, all } = await begin(2);

    await playing(host);

    await finishLevel(host, all);

    const cleared = await waitFor(() => event(host, "levelCompleted"), "level cleared");

    assert.deepEqual(
      {
        completedLevel: cleared.data.completedLevel,
        nextLevel: cleared.data.nextLevel,
        final: cleared.data.final,
        clearMs: cleared.data.clearMs
      },
      { completedLevel: 1, nextLevel: 2, final: false, clearMs: 700 }
    );

    assert.ok(cleared.data.elapsedMs > 0, "reports how long the level took");

    // ---- LEVEL CLEAR: everyone is held where they stand ----

    await waitFor(() => host.state!.phase === "clear", "clear phase in the state");

    assert.equal(host.state!.levelElapsedMs, 0, "the level timer is stopped");

    const here = { host: position(host, host), guest: position(host, others[0]) };

    const loadedBefore = host.count("levelLoaded");

    for (const bot of all) {
      bot.input = { right: true, jump: true };
    }

    await sleep(300);

    assert.deepEqual(position(host, host), here.host, "frozen (host)");
    assert.deepEqual(position(host, others[0]), here.guest, "frozen (guest)");

    assert.equal(host.state!.levelElapsedMs, 0, "the timer stays stopped during LEVEL CLEAR");

    assert.equal(host.count("levelLoaded"), loadedBefore, "the next level is not loaded yet");
    assert.equal(host.count("levelCompleted"), 1);

    // ---- the next level loads after the clear time ----

    const next = await waitFor(
      () => host.events.slice(host.events.indexOf(cleared) + 1).find((e) => e.type === "levelLoaded"),
      "next level loaded",
      3000
    );

    const clearScreen = next.at - cleared.at;

    assert.ok(clearScreen >= 640 && clearScreen < 1100, `LEVEL CLEAR was up for ${clearScreen} ms`);

    assert.equal(host.level!.level, 2);

    // ---- LEVEL 2: held at the spawn points, no timer ----

    await waitFor(() => event(host, "levelIntro", host.events.indexOf(cleared)), "LEVEL 2 screen");

    const intro = event(host, "levelIntro", host.events.indexOf(cleared))!;

    assert.deepEqual({ level: intro.data.level, introMs: intro.data.introMs }, { level: 2, introMs: 800 });

    await waitFor(() => host.state!.phase === "intro", "intro phase in the state");

    assert.equal(host.state!.level, 2);
    assert.equal(host.state!.levelElapsedMs, 0);

    const spawn = { x: SPAWN_POSITIONS[0].x, y: SPAWN_POSITIONS[0].y };

    assert.deepEqual(position(host, host), spawn);

    for (const bot of all) {
      bot.input = { left: true, jump: true };
    }

    await sleep(350);

    assert.deepEqual(position(host, host), spawn, "still held during the LEVEL 2 screen");

    assert.equal(host.state!.levelElapsedMs, 0, "no timer during the LEVEL 2 screen either");

    // ---- and then it starts ----

    const started = await waitFor(
      () => event(host, "levelStarted", host.events.indexOf(cleared)),
      "level 2 starts",
      3000
    );

    const introScreen = started.at - next.at;

    assert.ok(introScreen >= 740 && introScreen < 1300, `LEVEL 2 was up for ${introScreen} ms`);

    assert.equal(started.data.level, 2);

    await waitFor(() => host.state!.phase === "playing", "playing");

    for (const bot of all) {
      bot.input = { right: true };
    }

    const x = host.me!.x;

    await waitFor(() => host.me!.x > x + 20, "movement is back");

    assert.ok(host.state!.levelElapsedMs! < 1500, "the timer restarted from zero for level 2");
  });

  test("nothing can be collected or completed while a screen is up", async () => {

    setDurations(0.6, 0.6);

    const { host } = await begin(1);

    const room = serverRoom(host);

    // During the LEVEL 1 screen: a crystal under the player is not picked up.

    const crystal = [...room.crystals.values()][0];

    const scoreBefore = room.score as number;

    teleport(host, host, crystal.x, crystal.y);

    await sleep(250);

    assert.equal(room.crystals.get(crystal.id).collected, false, "no pickups during the intro");
    assert.equal(room.score, scoreBefore);

    await playing(host);

    await waitFor(() => room.crystals.get(crystal.id).collected, "picked up once playing");
  });

  test("after the last level LEVEL CLEAR comes first, then the win, with no further level", async () => {

    setDurations(0.6, 0.1);

    const { host, all } = await begin(1);

    for (let level = 1; level <= 3; level++) {

      await waitFor(
        () => host.state!.level === level && serverRoom(host).phase === "playing",
        `level ${level} playing`,
        6000
      );

      await finishLevel(host, all);

      await waitFor(() => host.count("levelCompleted") === level, `level ${level} cleared`);
    }

    const last = host.last("levelCompleted");

    assert.equal(last.final, true);
    assert.equal(last.nextLevel, null);
    assert.equal(last.completedLevel, 3);

    assert.equal(host.count("gameFinished"), 0, "the win screen waits for LEVEL CLEAR");
    assert.equal(host.state!.phase, "clear");

    await sleep(300);

    assert.equal(host.count("gameFinished"), 0, "still on LEVEL CLEAR");

    await waitFor(() => host.count("gameFinished") === 1, "win screen after the clear screen", 3000);

    const cleared = host.events.filter((e) => e.type === "levelCompleted").at(-1)!;

    const finished = host.events.find((e) => e.type === "gameFinished")!;

    assert.ok(finished.at - cleared.at >= 540, `win came ${finished.at - cleared.at} ms after LEVEL CLEAR`);

    assert.equal(host.count("levelIntro"), 3, "no LEVEL 4 screen: one intro per level only");
  });

  test("a player who leaves during LEVEL CLEAR does not stop the next level", async () => {

    setDurations(0.7, 0.2);

    const { host, others, all } = await begin(2);

    await playing(host);

    await finishLevel(host, all);

    await waitFor(() => event(host, "levelCompleted"), "cleared");

    await others[0].leave();

    await waitFor(() => host.level!.level === 2, "level 2 loads for the one who is left", 3000);

    await playing(host);

    assert.equal(serverRoom(host).players.size, 1);
  });

  test("someone reconnecting during LEVEL CLEAR is told which screen is up and for how long", async () => {

    setDurations(1.5, 0.2);

    const { host, others, all } = await begin(2);

    const guest = others[0];

    await playing(host);

    await finishLevel(host, all);

    await waitFor(() => event(host, "levelCompleted"), "cleared");

    guest.drop();

    await waitFor(() => guest.reconnects >= 1, "guest reconnects", 8000);

    const resync = await waitFor(() => guest.last("resync"), "resync");

    assert.equal(resync.phase, "clear");
    assert.ok(resync.phaseMsLeft > 0 && resync.phaseMsLeft <= 1500, `${resync.phaseMsLeft} ms left`);
    assert.equal(resync.levelElapsedMs, 0);

    // The transition carries on and includes them.
    await waitFor(() => guest.level?.level === 2, "guest gets level 2", 4000);

    await playing(host);

    assert.equal(serverRoom(host).players.get(guest.id).connected, true);
  });

  test("every level has its own intro, with its crystals back and door closed", async () => {

    setDurations(0.1, 0.1);

    const { host, all } = await begin(1);

    for (let level = 1; level <= 2; level++) {

      await waitFor(
        () => host.state!.level === level && serverRoom(host).phase === "playing",
        `level ${level} playing`,
        6000
      );

      await finishLevel(host, all);

      await waitFor(() => host.count("levelCompleted") === level, "cleared");

      await waitFor(() => host.count("levelIntro") === level + 1, `intro of level ${level + 1}`, 4000);

      const next = host.last("levelLoaded");

      assert.equal(next.level, level + 1);
      assert.equal(next.doorOpen, false);
      assert.equal(next.crystals.length, LEVELS[level].crystals.length);
      assert.ok(next.crystals.every((c: any) => !c.collected));
    }
  });
});
