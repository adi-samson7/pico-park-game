import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import type { App } from "../src/app.js";

import {
  FULL_RUN,
  Leaderboard,
  fileStore,
  getLeaderboard,
  setLeaderboard
} from "../src/leaderboard.js";

import {
  Bot,
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

// The board the shared app uses (starting another app replaces the one in
// use, so tests that do so put this back).
let shared: Leaderboard;

let open: Bot[] = [];

const track = <T extends Bot>(bot: T): T => {
  open.push(bot);
  return bot;
};

before(async () => {

  app = await startApp();
});

// Every test starts with an empty board: results of earlier tests must not
// change who is "first".
beforeEach(() => {

  shared = new Leaderboard();

  setLeaderboard(shared);
});

afterEach(async () => {

  delete process.env.RECONNECT_WINDOW_SECONDS;

  await Promise.all(open.map((b) => b.leave()));

  open = [];
});

after(async () => {
  await app.close();
});

const playing = (host: Bot) =>
  waitFor(() => serverRoom(host).phase === "playing", "the level to be playing", 8000);

/** Collects every crystal and puts the given players into the door. */
async function finishLevel(host: Bot, inDoor: Bot[]) {

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

  inDoor.forEach((bot, i) =>
    teleport(host, bot, room.exit.x + (i % 2 ? 30 : -30), room.exit.y)
  );
}

/** A started game; `names` become the players' names. */
async function game(names: string[]) {

  const host = track(await createRoom(app, { name: names[0] }));

  const others: Bot[] = [];

  for (const name of names.slice(1)) {
    others.push(track(await joinRoom(app, host, { name })));
  }

  await startGame(host, others);

  return { host, others, all: [host, ...others] };
}

describe("a cleared level goes on the board", () => {

  test("with who played, how many they were and the time the level was played", async () => {

    const { host, all } = await game(["Ada", "Sam"]);

    await finishLevel(host, all);

    await waitFor(() => host.count("levelCompleted") === 1, "level cleared");

    const cleared = host.last("levelCompleted");

    const top = getLeaderboard().top(1);

    assert.equal(top.length, 1);
    assert.deepEqual(top[0].names.sort(), ["Ada", "Sam"]);
    assert.equal(top[0].size, 2);
    assert.equal(top[0].level, 1);
    assert.equal(top[0].ms, cleared.elapsedMs, "the board holds exactly the time the players were shown");

    assert.deepEqual(
      { rank: cleared.rank, record: cleared.record, previousBest: cleared.previousBest, teamSize: cleared.teamSize },
      { rank: 1, record: true, previousBest: null, teamSize: 2 },
      "the first time is a record"
    );
  });

  test("the time counts from the end of the LEVEL screen, not from the start of the game", async () => {

    process.env.LEVEL_INTRO_SECONDS = "0.7";

    try {

      const { host, all } = await game(["Ada"]);

      await finishLevel(host, all);

      await waitFor(() => host.count("levelCompleted") === 1, "level cleared");

      const ms = host.last("levelCompleted").elapsedMs;

      // The 0.7 s intro was waited for in startGame(); finishing took a
      // moment. Counting the intro would make it more than 700 ms by itself.
      assert.ok(ms < 700 + 1500, `${ms} ms`);

      assert.ok(ms > 0);

    } finally {
      process.env.LEVEL_INTRO_SECONDS = "0.05";
    }
  });

  test("a slower run ranks behind, a faster run takes the record", async () => {

    const slow = await game(["Ada", "Sam"]);

    await sleep(900);

    await finishLevel(slow.host, slow.all);

    await waitFor(() => slow.host.count("levelCompleted") === 1, "slow run cleared");

    const slowMs = slow.host.last("levelCompleted").elapsedMs;

    assert.ok(slowMs >= 900);

    const next = await game(["Bob", "Cy"]);

    await finishLevel(next.host, next.all);

    await waitFor(() => next.host.count("levelCompleted") === 1, "fast run cleared");

    const fast = next.host.last("levelCompleted");

    assert.ok(fast.elapsedMs < slowMs);

    assert.deepEqual(
      { rank: fast.rank, record: fast.record, previousBest: fast.previousBest },
      { rank: 1, record: true, previousBest: slowMs },
      "a new record, and it says what it beat"
    );

    // And a third run, slower than the fast one but faster than the slow one:
    const third = await game(["Di", "Ed"]);

    await sleep(300);

    await finishLevel(third.host, third.all);

    await waitFor(() => third.host.count("levelCompleted") === 1, "third run cleared");

    const mid = third.host.last("levelCompleted");

    assert.equal(mid.rank, 2);
    assert.equal(mid.record, false);
    assert.equal(mid.previousBest, fast.elapsedMs);

    assert.deepEqual(
      getLeaderboard().top(1, 2).map((e) => e.names.sort().join("+")),
      ["Bob+Cy", "Di+Ed", "Ada+Sam"],
      "the board is in order of time"
    );
  });

  test("a solo run is not ranked against a team", async () => {

    const team = await game(["Ada", "Sam"]);

    await finishLevel(team.host, team.all);

    await waitFor(() => team.host.count("levelCompleted") === 1, "team cleared");

    const solo = await game(["Loner"]);

    await sleep(500);

    await finishLevel(solo.host, solo.all);

    await waitFor(() => solo.host.count("levelCompleted") === 1, "solo cleared");

    const result = solo.host.last("levelCompleted");

    assert.equal(result.rank, 1, "first among solo runs even though slower");
    assert.equal(result.record, true);
    assert.equal(result.teamSize, 1);
  });

  test("players who dropped out are not credited, and do not count towards the team size", async () => {

    process.env.RECONNECT_WINDOW_SECONDS = "30";

    const { host, others } = await game(["Ada", "Sam"]);

    others[0].room.reconnection.enabled = false;

    others[0].drop();

    await waitFor(() => host.events.some((e) => e.type === "playerDropped"), "drop noticed");

    await playing(host);

    await finishLevel(host, [host]);

    await waitFor(() => host.count("levelCompleted") === 1, "cleared without the absent player");

    const entry = getLeaderboard().top(1)[0];

    assert.deepEqual(entry.names, ["Ada"]);
    assert.equal(entry.size, 1);
    assert.equal(host.last("levelCompleted").teamSize, 1);
  });

  test("every level has its own board", async () => {

    const { host, all } = await game(["Ada", "Sam"]);

    for (let level = 1; level <= 2; level++) {

      await waitFor(
        () => host.state?.level === level && serverRoom(host).phase === "playing",
        `level ${level} playing`,
        6000
      );

      await finishLevel(host, all);

      await waitFor(() => host.count("levelCompleted") === level, `level ${level} cleared`);
    }

    assert.equal(getLeaderboard().top(1).length, 1);
    assert.equal(getLeaderboard().top(2).length, 1);
    assert.equal(getLeaderboard().top(3).length, 0);
  });
});

describe("the whole game", () => {

  async function winGame(host: Bot, all: Bot[]) {

    for (let level = 1; level <= 3; level++) {

      await waitFor(
        () => host.state?.level === level && serverRoom(host).phase === "playing",
        `level ${level} playing`,
        6000
      );

      await finishLevel(host, all);

      await waitFor(() => host.count("levelCompleted") === level, `level ${level} cleared`);
    }

    await waitFor(() => host.count("gameFinished") === 1, "win", 4000);
  }

  test("winning records the total of the three levels, and says where it ranks", async () => {

    const { host, all } = await game(["Ada", "Sam"]);

    await winGame(host, all);

    const times = host.events
      .filter((e) => e.type === "levelCompleted")
      .map((e) => e.data.elapsedMs as number);

    assert.equal(times.length, 3);

    const won = host.last("gameFinished");

    assert.equal(won.totalMs, times[0] + times[1] + times[2], "the sum of the level times");

    assert.deepEqual(
      { rank: won.rank, record: won.record, teamSize: won.teamSize },
      { rank: 1, record: true, teamSize: 2 }
    );

    const entry = getLeaderboard().top(FULL_RUN)[0];

    assert.equal(entry.ms, won.totalMs);
    assert.deepEqual(entry.names.sort(), ["Ada", "Sam"]);
  });

  test("a second game in the same room starts counting from zero", async () => {

    const { host, all } = await game(["Ada", "Sam"]);

    await winGame(host, all);

    const first = host.last("gameFinished").totalMs;

    for (const bot of all) {
      bot.room.send("toggleReady");
    }

    await waitFor(() => serverRoom(host).areAllPlayersReady(), "ready again");

    host.room.send("startGame");

    await waitFor(() => host.count("gameStarted") === 2, "second game");

    for (let level = 1; level <= 3; level++) {

      await waitFor(
        () => host.state?.level === level && serverRoom(host).phase === "playing",
        `level ${level} playing`,
        6000
      );

      await finishLevel(host, all);

      await waitFor(() => host.count("levelCompleted") === 3 + level, `level ${level} cleared`);
    }

    await waitFor(() => host.count("gameFinished") === 2, "second win", 4000);

    const second = host.last("gameFinished").totalMs;

    const secondLevels = host.events
      .filter((e) => e.type === "levelCompleted")
      .slice(3)
      .map((e) => e.data.elapsedMs as number);

    assert.equal(second, secondLevels.reduce((a, b) => a + b, 0), "not carried over from the first game");

    assert.ok(second < first * 3, "plausible");

    assert.equal(getLeaderboard().top(FULL_RUN).length, 2);
  });

  test("a game that is ended any other way records no total", async () => {

    const { host } = await game(["Ada"]);

    serverRoom(host).finishGame();

    await waitFor(() => host.count("gameFinished") === 1, "finished");

    const won = host.last("gameFinished");

    assert.equal(won.totalMs, null);
    assert.equal(won.rank, null);
    assert.equal(won.record, false);
    assert.equal(getLeaderboard().top(FULL_RUN).length, 0);
  });
});

describe("the leaderboard over HTTP", () => {

  const get = async (query = "") => {

    const response = await fetch(`http://127.0.0.1:${app.port}/leaderboard${query}`);

    return { response, body: (await response.json()) as any };
  };

  test("is empty at first, with a board for every level and the whole game", async () => {

    // (every test starts with an empty board)
    const { response, body } = await get();

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body.boards).sort(), ["0", "1", "2", "3"]);

    for (const board of Object.values(body.boards)) {
      assert.deepEqual(board, []);
    }

    assert.equal(body.maxLevels, 3);
    assert.equal(body.size, 0);
  });

  test("lists the results, best first, and can be limited to a team size", async () => {

    const { host, all } = await game(["Ada", "Sam"]);

    await sleep(300);

    await finishLevel(host, all);

    await waitFor(() => host.count("levelCompleted") === 1, "cleared");

    const solo = await game(["Loner"]);

    await finishLevel(solo.host, solo.all);

    await waitFor(() => solo.host.count("levelCompleted") === 1, "solo cleared");

    const everything = await get();

    assert.equal(everything.body.size, 0);
    assert.equal(everything.body.boards["1"].length, 2);
    assert.ok(everything.body.boards["1"][0].ms <= everything.body.boards["1"][1].ms);

    const duo = await get("?size=2");

    assert.equal(duo.body.size, 2);
    assert.deepEqual(duo.body.boards["1"].map((e: any) => e.names.sort()), [["Ada", "Sam"]]);

    const four = await get("?size=4");

    assert.deepEqual(four.body.boards["1"], []);

    // nonsense falls back to "all"
    for (const junk of ["?size=0", "?size=9", "?size=abc", "?size=-1", "?size=1.5"]) {
      assert.equal((await get(junk)).body.size, 0, junk);
    }
  });

  test("is readable from another origin and never cached", async () => {

    const { response } = await get();

    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cache-control"), "no-store");

    const preflight = await fetch(`http://127.0.0.1:${app.port}/leaderboard`, { method: "OPTIONS" });

    assert.equal(preflight.status, 204);
  });

  test("each entry has what the screen needs and nothing private", async () => {

    const { host, all } = await game(["Ada", "Sam"]);

    await finishLevel(host, all);

    await waitFor(() => host.count("levelCompleted") === 1, "cleared");

    const { body } = await get();

    for (const entry of body.boards["1"]) {
      assert.deepEqual(Object.keys(entry).sort(), ["at", "level", "ms", "names", "size"]);
    }
  });
});

describe("kept between restarts", () => {

  test("a result is still there after a restart (a new board loaded from the same file)", async () => {

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pico-persist-"));

    const file = path.join(dir, "data", "leaderboard.json");

    try {

      // ---- a server that keeps its board in a file (what index.ts does) ----

      setLeaderboard(new Leaderboard(fileStore(file)));

      const host = track(await createRoom(app, { name: "Ada" }));

      await startGame(host, []);

      await finishLevel(host, [host]);

      await waitFor(() => host.count("levelCompleted") === 1, "a level cleared");

      const ms = host.last("levelCompleted").elapsedMs;

      assert.ok(fs.existsSync(file), "written to disk as soon as the level was cleared");

      // ---- a restart: everything in memory is gone, the file is read again ----

      setLeaderboard(new Leaderboard(fileStore(file)));

      const body: any = await (await fetch(`http://127.0.0.1:${app.port}/leaderboard`)).json();

      assert.equal(body.boards["1"].length, 1);
      assert.equal(body.boards["1"][0].ms, ms);
      assert.deepEqual(body.boards["1"][0].names, ["Ada"]);

    } finally {

      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
