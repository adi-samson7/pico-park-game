import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EXIT_HEIGHT,
  EXIT_REACH_Y,
  EXIT_WIDTH,
  LEVELS,
  SPAWN_POSITIONS,
  type LevelData
} from "../src/levels.js";

import {
  PHYSICS,
  stepPlayers,
  touchesSpikes,
  tryJump,
  type PhysicsBody
} from "../src/physics.js";

const DT = 1 / 60;

const body = (id: string, x: number, y: number): PhysicsBody => ({
  id,
  x,
  y,
  velocityX: 0,
  velocityY: 0,
  alive: true,
  jumpCount: 0,
  grounded: false,
  standingOn: null
});

// ==========================================
// STRUCTURE
// ==========================================

describe("level data", () => {

  test("three levels and four spawn slots", () => {

    assert.equal(LEVELS.length, 3);
    assert.equal(SPAWN_POSITIONS.length, 4);
  });

  LEVELS.forEach((level, i) => {

    describe(`level ${i + 1}`, () => {

      test("has crystals, all inside the world and not underground", () => {

        assert.ok(level.crystals.length > 0);

        for (const c of level.crystals) {

          assert.ok(c.x > 0 && c.x < PHYSICS.WORLD_WIDTH, `crystal x ${c.x}`);
          assert.ok(c.y > 0 && c.y < PHYSICS.GROUND_TOP, `crystal y ${c.y}`);
        }

        const keys = level.crystals.map((c) => `${c.x},${c.y}`);

        assert.equal(new Set(keys).size, keys.length, "no duplicate crystals");
      });

      test("platforms are inside the world", () => {

        for (const p of level.platforms) {

          assert.ok(p.x - p.width / 2 >= 0 && p.x + p.width / 2 <= PHYSICS.WORLD_WIDTH, "horizontal");
          assert.ok(p.y + p.height / 2 <= PHYSICS.GROUND_TOP, "above the ground");
        }
      });

      test("pits are ordered, separate and inside the world", () => {

        let previousEnd = 0;

        for (const pit of level.pits) {

          assert.ok(pit.x1 < pit.x2);
          assert.ok(pit.x1 > previousEnd, "pits must not touch or overlap");
          assert.ok(pit.x2 < PHYSICS.WORLD_WIDTH);

          previousEnd = pit.x2;
        }
      });

      test("spikes are inside the world", () => {

        for (const s of level.spikes) {

          assert.ok(s.x - s.width / 2 >= 0 && s.x + s.width / 2 <= PHYSICS.WORLD_WIDTH);
          assert.ok(s.y <= PHYSICS.GROUND_TOP);
        }
      });

      test("the exit door stands on a platform", () => {

        const doorBottom = level.exit.y + EXIT_HEIGHT / 2;

        const platform = level.platforms.find(
          (p) =>
            Math.abs(p.y - p.height / 2 - doorBottom) <= 2 &&
            Math.abs(level.exit.x - p.x) <= p.width / 2
        );

        assert.ok(platform, "door must rest on a platform");
      });

      test("all four players can stand inside the door at the same time", () => {

        // Players are solid, so four of them take 160px side by side.
        const players = [-60, -20, 20, 60].map((dx, k) =>
          body(`p${k}`, level.exit.x + dx, level.exit.y - 40)
        );

        for (let t = 0; t < 180; t++) {
          stepPlayers(players, level.platforms, DT, level.pits);
        }

        const inside = players.filter(
          (p) =>
            Math.abs(p.x - level.exit.x) < EXIT_WIDTH / 2 &&
            Math.abs(p.y - level.exit.y) < EXIT_REACH_Y
        );

        assert.equal(
          inside.length,
          4,
          `only ${inside.length} fit: ${players.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ")}`
        );
        assert.ok(players.every((p) => p.grounded));
      });
    });
  });
});

// ==========================================
// SPAWNS
// ==========================================

describe("spawns", () => {

  /** Simulates 4 s with nobody touching anything. */
  function dropIn(level: LevelData, positions: { x: number; y: number }[]) {

    const players = positions.map((p, k) => body(`p${k}`, p.x, p.y));

    for (let t = 0; t < 240; t++) {

      const fell = stepPlayers(players, level.platforms, DT, level.pits);

      if (fell.length) {
        return { verdict: "fell", players };
      }

      if (players.some((p) => touchesSpikes(p, level.spikes))) {
        return { verdict: "spiked", players };
      }
    }

    return { verdict: "safe", players };
  }

  LEVELS.forEach((level, i) => {

    test(`level ${i + 1}: all four players dropping in at once land safely`, () => {

      const { verdict, players } = dropIn(level, SPAWN_POSITIONS);

      assert.equal(verdict, "safe");
      assert.ok(players.every((p) => p.grounded), "everyone ends up standing");
    });

    test(`level ${i + 1}: each spawn slot is safe on its own (respawns must never kill)`, () => {

      for (const spawn of SPAWN_POSITIONS) {

        const { verdict, players } = dropIn(level, [spawn]);

        assert.equal(verdict, "safe", `spawn x=${spawn.x}`);
        assert.ok(players[0].grounded);
      }
    });
  });
});

// ==========================================
// REACHABILITY
// ==========================================
//
// Breadth-first search over the real physics:
// from spawn, try every combination of
// left / right / jump (each held for 5 ticks)
// and record every state reachable WITHOUT
// dying. Every crystal and the exit must be
// in that set.

const TICKS = 5;

interface State {
  x: number;
  y: number;
  vy: number;
  jumps: number;
  grounded: boolean;
}

const keyOf = (s: State) =>
  `${Math.round(s.x / 6)}|${Math.round(s.y / 6)}|${Math.round(s.vy / 60)}|${s.jumps}|${s.grounded ? 1 : 0}`;

function explore(level: LevelData) {

  const start: State = {
    x: SPAWN_POSITIONS[0].x,
    y: SPAWN_POSITIONS[0].y,
    vy: 0,
    jumps: 0,
    grounded: false
  };

  const seen = new Set([keyOf(start)]);

  const queue = [start];

  const reachable: State[] = [];

  const deaths = { fell: 0, spikes: 0 };

  while (queue.length) {

    const state = queue.shift()!;

    reachable.push(state);

    for (const dir of [-1, 0, 1]) {

      for (const jump of [false, true]) {

        const b = body("p", state.x, state.y);

        b.velocityY = state.vy;
        b.jumpCount = state.jumps;
        b.grounded = state.grounded;
        b.velocityX = dir * PHYSICS.MOVE_SPEED;

        let died = false;

        for (let t = 0; t < TICKS && !died; t++) {

          if (jump && t === 0) tryJump(b);

          if (stepPlayers([b], level.platforms, DT, level.pits).length) {
            deaths.fell++;
            died = true;
          } else if (touchesSpikes(b, level.spikes)) {
            deaths.spikes++;
            died = true;
          }
        }

        if (died) continue;

        const next: State = {
          x: b.x,
          y: b.y,
          vy: b.velocityY,
          jumps: b.jumpCount,
          grounded: b.grounded
        };

        const k = keyOf(next);

        if (!seen.has(k)) {
          seen.add(k);
          queue.push(next);
        }
      }
    }
  }

  return { reachable, deaths };
}

describe("reachability (exhaustive search over the real physics)", () => {

  LEVELS.forEach((level, i) => {

    test(`level ${i + 1}: every crystal and the exit can be reached alive; hazards are lethal`, () => {

      const { reachable, deaths } = explore(level);

      const missing = level.crystals.filter(
        (c) => !reachable.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < 45)
      );

      assert.deepEqual(missing, [], "unreachable crystals");

      const exitReachable = reachable.some(
        (s) =>
          s.grounded &&
          Math.abs(s.x - level.exit.x) < EXIT_WIDTH / 2 &&
          Math.abs(s.y - level.exit.y) < EXIT_REACH_Y
      );

      assert.ok(exitReachable, "exit must be reachable");

      // guards against a vacuous pass: the hazards really do kill
      if (level.pits.length) {
        assert.ok(deaths.fell > 0, "pits must be lethal");
      }

      if (level.spikes.length) {
        assert.ok(deaths.spikes > 0, "spikes must be lethal");
      }
    });
  });
});
