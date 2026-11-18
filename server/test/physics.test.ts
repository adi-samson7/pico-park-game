import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PHYSICS,
  groundSupports,
  stepPlayers,
  touchesSpikes,
  tryJump,
  type PhysicsBody,
  type PhysicsPlatform,
  type Pit,
  type Spikes
} from "../src/physics.js";

const H = PHYSICS.PLAYER_HEIGHT;

const GROUND_Y = PHYSICS.GROUND_TOP - H / 2;

const DT = 1 / 60;

// ==========================================
// HELPERS
// ==========================================

function body(id: string, x: number, y: number): PhysicsBody {

  return {
    id,
    x,
    y,
    velocityX: 0,
    velocityY: 0,
    alive: true,
    jumpCount: 0,
    grounded: false,
    standingOn: null
  };
}

/** Runs the simulation; returns ids reported as
 *  having fallen out of the world. */
function run(
  players: PhysicsBody[],
  seconds: number,
  options: {
    platforms?: PhysicsPlatform[];
    pits?: Pit[];
    dt?: number;
    each?: (t: number) => void;
  } = {}
): string[] {

  const dt = options.dt ?? DT;

  const fallen: string[] = [];

  for (let i = 0; i < Math.round(seconds / dt); i++) {

    options.each?.(i * dt);

    fallen.push(
      ...stepPlayers(players, options.platforms ?? [], dt, options.pits ?? [])
    );
  }

  return fallen;
}

const settle = (
  players: PhysicsBody[],
  platforms: PhysicsPlatform[] = []
) => run(players, 1.5, { platforms });

// ==========================================
// DOUBLE JUMP
// ==========================================

describe("double jump", () => {

  test("two jumps, a third is refused, and landing resets", () => {

    const a = body("a", 400, GROUND_Y);

    settle([a]);

    assert.ok(a.grounded);
    assert.equal(a.jumpCount, 0);

    assert.ok(tryJump(a), "jump 1");

    let minY = a.y;

    run([a], 0.25, { each: () => (minY = Math.min(minY, a.y)) });

    assert.ok(tryJump(a), "jump 2 in the air");
    assert.ok(!tryJump(a), "jump 3 refused");

    run([a], 1.5, { each: () => (minY = Math.min(minY, a.y)) });

    assert.ok(GROUND_Y - minY > 150, `double jump should be much higher than ~104px, got ${GROUND_Y - minY}`);
    assert.ok(a.grounded);
    assert.equal(a.jumpCount, 0);
    assert.ok(tryJump(a), "can jump again after landing");
  });

  test("walking off a ledge uses up the first jump", () => {

    const ledge: PhysicsPlatform[] = [{ x: 200, y: 400, width: 100, height: 20 }];

    const a = body("a", 240, 390 - H / 2);

    settle([a], ledge);

    assert.ok(a.grounded);

    a.velocityX = PHYSICS.MOVE_SPEED;

    run([a], 0.25, { platforms: ledge });

    a.velocityX = 0;

    assert.ok(!a.grounded, "airborne after leaving the ledge");
    assert.ok(tryJump(a), "one air jump");
    assert.ok(!tryJump(a), "but not two");
  });
});

// ==========================================
// STACKING
// ==========================================

describe("player stacking", () => {

  test("a falling player lands on another's head", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 305, 200);

    settle([a, b]);

    assert.ok(Math.abs(a.y - b.y - H) < 0.01);
    assert.equal(b.standingOn, "a");
    assert.ok(b.grounded);
  });

  test("the rider is carried when the player below walks", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 300, 200);

    settle([a, b]);

    const ax = a.x;
    const bx = b.x;

    a.velocityX = PHYSICS.MOVE_SPEED;

    run([a, b], 0.5);

    a.velocityX = 0;

    run([a, b], 0.2);

    assert.ok(Math.abs(a.x - ax - (b.x - bx)) < 0.01);
    assert.ok(Math.abs(a.y - b.y - H) < 0.01);
  });

  test("the rider stays on while the player below jumps", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 300, 200);

    settle([a, b]);

    let minGap = Infinity;
    let maxGap = 0;

    tryJump(a);

    run([a, b], 1.2, {
      each: () => {
        minGap = Math.min(minGap, a.y - b.y);
        maxGap = Math.max(maxGap, a.y - b.y);
      }
    });

    assert.ok(minGap > H - 0.5 && maxGap < H + 0.5, `gap ${minGap}..${maxGap}`);
    assert.equal(b.standingOn, "a");
  });

  test("the rider falls to the ground after walking off the head", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 300, 200);

    settle([a, b]);

    b.velocityX = PHYSICS.MOVE_SPEED;

    run([a, b], 0.6);

    b.velocityX = 0;

    run([a, b], 1.0);

    assert.equal(b.standingOn, null);
    assert.ok(Math.abs(b.y - GROUND_Y) < 0.01);
  });

  test("a rider can double-jump off a head and land back on it", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 300, 200);

    settle([a, b]);

    assert.ok(tryJump(b));

    run([a, b], 0.2);

    assert.ok(tryJump(b));
    assert.ok(!tryJump(b));

    run([a, b], 1.5);

    assert.equal(b.standingOn, "a");
    assert.equal(b.jumpCount, 0);
  });

  test("a stack of three moves and jumps as one", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 300, 250);
    const c = body("c", 300, 100);

    run([a, b, c], 2.5);

    assert.equal(b.standingOn, "a");
    assert.equal(c.standingOn, "b");

    const cx = c.x;

    a.velocityX = -PHYSICS.MOVE_SPEED;

    run([a, b, c], 0.5);

    assert.ok(Math.abs(c.x - cx + PHYSICS.MOVE_SPEED * 0.5) < 0.5);

    a.velocityX = 0;

    tryJump(a);

    let minGap = Infinity;

    run([a, b, c], 1.2, { each: () => (minGap = Math.min(minGap, a.y - c.y)) });

    assert.ok(minGap > 2 * H - 0.5, `A-C gap ${minGap}`);
    assert.equal(c.standingOn, "b");
    assert.equal(b.standingOn, "a");
  });

  test("works with a slow 20 Hz server tick", () => {

    const a = body("a", 300, GROUND_Y);
    const b = body("b", 300, 200);

    run([a, b], 2, { dt: 1 / 20 });

    assert.equal(b.standingOn, "a");

    tryJump(a);

    let minGap = Infinity;

    run([a, b], 1.2, { dt: 1 / 20, each: () => (minGap = Math.min(minGap, a.y - b.y)) });

    assert.ok(minGap > H - 0.5);
    assert.equal(b.standingOn, "a");
  });

  test("a player lands on a head that is jumping up into them", () => {

    const a = body("a", 300, GROUND_Y);

    settle([a]);

    const b = body("b", 300, a.y - H - 3);

    a.velocityY = -500;
    a.grounded = false;

    stepPlayers([a, b], [], DT);

    assert.equal(b.standingOn, "a");
    assert.ok(Math.abs(a.y - b.y - H) < 0.01);
  });
});

// ==========================================
// SOLID PLAYERS
// ==========================================

test("players cannot walk through each other", () => {

  const a = body("a", 300, GROUND_Y);
  const b = body("b", 100, GROUND_Y);

  settle([a, b]);

  b.velocityX = PHYSICS.MOVE_SPEED;

  run([a, b], 2.0);

  assert.ok(b.x < a.x);
  assert.ok(Math.abs(a.x - b.x) >= PHYSICS.PLAYER_WIDTH - 0.5);
});

// ==========================================
// PLATFORMS
// ==========================================

describe("platforms", () => {

  test("are one-way: pass through going up, land on top coming down", () => {

    const low: PhysicsPlatform[] = [{ x: 400, y: 510, width: 200, height: 20 }];

    const a = body("a", 400, GROUND_Y);

    settle([a], low);

    tryJump(a);

    let snappedWhileRising = false;

    run([a], 0.4, {
      platforms: low,
      each: () => {
        if (a.velocityY < -50 && a.grounded) snappedWhileRising = true;
      }
    });

    assert.ok(!snappedWhileRising);

    run([a], 1.5, { platforms: low });

    assert.ok(a.grounded);
    assert.ok(Math.abs(a.y - (500 - H / 2)) < 0.01);
  });

  test("a very fast fall does not tunnel through a thin platform", () => {

    const plat: PhysicsPlatform[] = [{ x: 400, y: 400, width: 200, height: 20 }];

    const f = body("f", 400, 100);

    f.velocityY = 3000;

    stepPlayers([f], plat, 0.05);

    run([f], 0.3, { platforms: plat });

    assert.ok(Math.abs(f.y - (390 - H / 2)) < 0.01);
    assert.ok(f.grounded);
  });
});

// ==========================================
// PITS
// ==========================================

describe("pits", () => {

  const pits: Pit[] = [{ x1: 300, x2: 420 }];

  test("walking into a pit falls out of the world and is never snapped back up", () => {

    const w = body("w", 250, GROUND_Y);

    run([w], 0.5, { pits });

    const fell = run([w], 2.0, {
      pits,
      each: () => (w.velocityX = PHYSICS.MOVE_SPEED)
    });

    assert.ok(fell.includes("w"));
    assert.ok(w.y > GROUND_Y + 50);
  });

  test("a sliver of foot on the edge still stands, fully over the pit does not", () => {

    const edge = body("e", 300 - 19, GROUND_Y);

    run([edge], 1, { pits });

    assert.ok(edge.grounded);
    assert.ok(Math.abs(edge.y - GROUND_Y) < 0.01);

    const over = body("o", 300 + 21, GROUND_Y);

    const fell = run([over], 2, { pits });

    assert.ok(!over.grounded);
    assert.ok(fell.includes("o"));
  });

  test("a single jump clears a 120px pit", () => {

    const j = body("j", 270, GROUND_Y);

    run([j], 0.5, { pits });

    tryJump(j);

    const fell = run([j], 1.6, {
      pits,
      each: () => (j.velocityX = PHYSICS.MOVE_SPEED)
    });

    assert.equal(fell.length, 0);
    assert.ok(j.grounded);
    assert.ok(j.x > 420);
  });

  test("groundSupports matches the pit edges", () => {

    assert.ok(groundSupports(100, pits));
    assert.ok(groundSupports(300, pits), "overlaps the edge");
    assert.ok(!groundSupports(360, pits), "fully over");
    assert.ok(groundSupports(440, pits), "overlaps the far edge");
  });

  test("a rider falls with a support that drops into a pit", () => {

    const a = body("a", 250, GROUND_Y);
    const b = body("b", 250, 200);

    run([a, b], 1.5, { pits });

    assert.equal(b.standingOn, "a");

    const fell = run([a, b], 3, {
      pits,
      each: () => (a.velocityX = PHYSICS.MOVE_SPEED)
    });

    assert.ok(fell.includes("a"));
    assert.ok(fell.includes("b"));
  });
});

// ==========================================
// SPIKES
// ==========================================

describe("spikes", () => {

  const ground: Spikes[] = [{ x: 400, y: GROUND_Y + H / 2, width: 80 }];

  const standingAt = (x: number) => touchesSpikes(body("s", x, GROUND_Y), ground);

  test("standing in them is a hit, beside them is safe", () => {

    assert.ok(standingAt(400));
    assert.ok(!standingAt(300));
  });

  test("the side margin is forgiving", () => {

    // strip spans 360..440; the player's half-width is 20, margin 6
    assert.ok(standingAt(400 + 40 + 20 - 6 - 2), "inside the margin");
    assert.ok(!standingAt(400 + 40 + 20 - 6 + 1), "just outside it");
  });

  test("feet must sink into the spikes: jumping over is safe", () => {

    assert.ok(!touchesSpikes(body("j", 400, GROUND_Y - 40), ground));
    assert.ok(touchesSpikes(body("l", 400, GROUND_Y - 4), ground));
  });

  test("platform spikes hit a player standing on them, not beside them", () => {

    const plat: PhysicsPlatform[] = [{ x: 400, y: 400, width: 200, height: 20 }];

    const strip: Spikes[] = [{ x: 400, y: 390, width: 40 }];

    const on = body("p", 400, 390 - H / 2);

    settle([on], plat);

    assert.ok(touchesSpikes(on, strip));

    const beside = body("q", 330, 390 - H / 2);

    settle([beside], plat);

    assert.ok(!touchesSpikes(beside, strip));
  });

  test("a normal running jump clears an 80px strip", () => {

    const r = body("r", 300, GROUND_Y);

    settle([r]);

    tryJump(r);

    let hit = false;

    run([r], 1.0, {
      each: () => {
        r.velocityX = PHYSICS.MOVE_SPEED;
        if (touchesSpikes(r, ground)) hit = true;
      }
    });

    assert.ok(!hit);
    assert.ok(r.x > 440);
  });
});
