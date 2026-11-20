import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  FULL_RUN,
  Leaderboard,
  fileStore,
  type LeaderboardEntry
} from "../src/leaderboard.js";

let at = 1_000;

const entry = (
  level: number,
  ms: number,
  names: string[] = ["Ada"],
  extra: Partial<LeaderboardEntry> = {}
): LeaderboardEntry => ({
  level,
  ms,
  names,
  size: names.length,
  at: at++,
  ...extra
});

const temp: string[] = [];

const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pico-lb-"));
  temp.push(dir);
  return dir;
};

afterEach(() => {

  for (const dir of temp.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ranking", () => {

  test("the first result is a record, and the best time wins", () => {

    const board = new Leaderboard();

    const first = board.record(entry(1, 30_000));

    assert.deepEqual(first, { rank: 1, record: true, previousBest: null, size: 1 });

    const slower = board.record(entry(1, 40_000));

    assert.deepEqual(slower, { rank: 2, record: false, previousBest: 30_000, size: 1 });

    const faster = board.record(entry(1, 20_000));

    assert.deepEqual(faster, { rank: 1, record: true, previousBest: 30_000, size: 1 });

    assert.deepEqual(
      board.top(1).map((e) => e.ms),
      [20_000, 30_000, 40_000]
    );
  });

  test("a tie goes to whoever was first", () => {

    const board = new Leaderboard();

    board.record(entry(1, 25_000, ["First"]));

    const tie = board.record(entry(1, 25_000, ["Second"]));

    assert.equal(tie.rank, 2);
    assert.equal(tie.record, false, "equalling a record is not breaking it");

    assert.deepEqual(board.top(1).map((e) => e.names[0]), ["First", "Second"]);
  });

  test("levels are separate boards", () => {

    const board = new Leaderboard();

    board.record(entry(1, 10_000));

    const other = board.record(entry(2, 90_000));

    assert.equal(other.rank, 1, "first on level 2 even though slower than level 1");
    assert.equal(other.record, true);
  });

  test("team sizes are separate: a duo is not racing a foursome", () => {

    const board = new Leaderboard();

    board.record(entry(1, 20_000, ["A"]));

    const duo = board.record(entry(1, 30_000, ["A", "B"]));

    assert.equal(duo.rank, 1, "first among two-player runs");
    assert.equal(duo.record, true);
    assert.equal(duo.size, 2);

    const four = board.record(entry(1, 50_000, ["A", "B", "C", "D"]));

    assert.equal(four.rank, 1);

    // the screen can show them together or by size
    assert.deepEqual(board.top(1, 0).map((e) => e.ms), [20_000, 30_000, 50_000]);
    assert.deepEqual(board.top(1, 2).map((e) => e.ms), [30_000]);
    assert.deepEqual(board.top(1, 3), []);
  });

  test("the full run is its own board", () => {

    const board = new Leaderboard();

    board.record(entry(FULL_RUN, 120_000, ["A", "B"]));
    board.record(entry(1, 20_000, ["A", "B"]));

    assert.deepEqual(board.top(FULL_RUN).map((e) => e.ms), [120_000]);
    assert.deepEqual(board.top(1).map((e) => e.ms), [20_000]);
  });

  test("top returns at most the asked number", () => {

    const board = new Leaderboard();

    for (let i = 1; i <= 25; i++) {
      board.record(entry(1, i * 1000));
    }

    assert.equal(board.top(1).length, 10);
    assert.equal(board.top(1, 0, 3).length, 3);
    assert.equal(board.top(1, 0, 3)[0].ms, 1000);
  });

  test("only the best are kept, and a result that is not good enough says so", () => {

    const board = new Leaderboard(undefined, 5);

    for (let i = 1; i <= 5; i++) {
      board.record(entry(1, i * 1000));
    }

    const late = board.record(entry(1, 99_000));

    assert.equal(late.rank, null);
    assert.equal(late.record, false);
    assert.equal(board.size, 5);

    const good = board.record(entry(1, 500));

    assert.equal(good.rank, 1);
    assert.equal(board.size, 5, "the slowest was dropped to make room");
    assert.deepEqual(board.top(1).map((e) => e.ms), [500, 1000, 2000, 3000, 4000]);
  });

  test("boards() has every level and the full run", () => {

    const board = new Leaderboard();

    board.record(entry(1, 1000));
    board.record(entry(3, 3000));
    board.record(entry(FULL_RUN, 9000));

    const all = board.boards(3);

    assert.deepEqual(Object.keys(all).sort(), ["0", "1", "2", "3"]);
    assert.equal(all["1"].length, 1);
    assert.equal(all["2"].length, 0);
    assert.equal(all["0"][0].ms, 9000);
  });
});

describe("what is accepted", () => {

  test("nonsense results are refused, not stored", () => {

    const board = new Leaderboard();

    const bad: any[] = [
      null,
      "x",
      {},
      entry(1, 0),
      entry(1, -5),
      entry(1, NaN),
      entry(1, Infinity),
      entry(1, 1e12),
      { ...entry(1, 1000), names: [] },
      { ...entry(1, 1000), names: "Ada" },
      { ...entry(1, 1000), names: ["A", "B", "C", "D", "E"] },
      { ...entry(1, 1000), size: 0 },
      { ...entry(1, 1000), size: 9 },
      { ...entry(1, 1000), level: -1 },
      { ...entry(1, 1000), level: 1.5 },
      { ...entry(1, 1000), at: "now" }
    ];

    for (const item of bad) {

      const result = board.record(item);

      assert.equal(result.rank, null, JSON.stringify(item));
    }

    assert.equal(board.size, 0);
  });

  test("names are cleaned again whatever sent them", () => {

    const board = new Leaderboard();

    board.record(entry(1, 5000, ["<b>Evil</b>", "😀", "x".repeat(50)]));

    const names = board.top(1)[0].names;

    assert.equal(names[0], "bEvilb");
    assert.equal(names[1], "?", "nothing usable left");
    assert.equal(names[2].length, 12);
  });

  test("times are whole milliseconds", () => {

    const board = new Leaderboard();

    board.record(entry(1, 1234.6));

    assert.equal(board.top(1)[0].ms, 1235);
  });
});

describe("kept in a file", () => {

  test("results survive a restart", () => {

    const file = path.join(tempDir(), "board.json");

    const one = new Leaderboard(fileStore(file));

    one.record(entry(1, 12_000, ["Ada", "Sam"]));
    one.record(entry(2, 34_000, ["Ada"]));

    const two = new Leaderboard(fileStore(file));

    assert.equal(two.size, 2);
    assert.deepEqual(two.top(1)[0].names, ["Ada", "Sam"]);
    assert.equal(two.top(2)[0].ms, 34_000);

    // and keeps ranking against what was there
    const next = two.record(entry(1, 15_000, ["Ada", "Sam"]));

    assert.equal(next.rank, 2);
    assert.equal(next.previousBest, 12_000);
  });

  test("the folder is created, and no temporary file is left behind", () => {

    const file = path.join(tempDir(), "deep", "er", "board.json");

    new Leaderboard(fileStore(file)).record(entry(1, 1000));

    assert.ok(fs.existsSync(file));

    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["board.json"]);
  });

  test("a file that is not understood is set aside and the game starts fresh", () => {

    const dir = tempDir();

    const file = path.join(dir, "board.json");

    fs.writeFileSync(file, "{{{ definitely not json");

    const board = new Leaderboard(fileStore(file));

    assert.equal(board.size, 0);

    assert.ok(
      fs.readdirSync(dir).some((f) => f.startsWith("board.json.corrupt-")),
      "the bad file was kept for inspection"
    );

    // and it works afterwards
    board.record(entry(1, 7000));

    assert.equal(new Leaderboard(fileStore(file)).size, 1);
  });

  test("bad entries inside a good file are skipped, the rest are kept", () => {

    const file = path.join(tempDir(), "board.json");

    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: [
          entry(1, 5000),
          { level: "one", ms: 1 },
          null,
          entry(1, -3),
          entry(2, 6000)
        ]
      })
    );

    const board = new Leaderboard(fileStore(file));

    assert.equal(board.size, 2);
  });

  test("a disk that cannot be written never throws into the game", () => {

    const board = new Leaderboard({
      load: () => [],
      save: () => { throw new Error("disk full"); }
    });

    assert.doesNotThrow(() => board.record(entry(1, 1000)));

    assert.equal(board.top(1).length, 1, "the result still counts in memory");
  });

  test("a store that cannot be read gives an empty board", () => {

    const board = new Leaderboard({
      load: () => { throw new Error("permission denied"); },
      save: () => {}
    });

    assert.equal(board.size, 0);
  });
});
