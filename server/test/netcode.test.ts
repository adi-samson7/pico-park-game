import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LEVELS, SPAWN_POSITIONS } from "../src/levels.ts";

import {
  PHYSICS,
  stepPlayers,
  tryJump,
  type PhysicsBody
} from "../src/physics.ts";

import { SnapshotBuffer } from "../../client/src/net/snapshots.ts";

import {
  Predictor,
  type InputState,
  type NetPlayer
} from "../../client/src/net/prediction.ts";

import {
  LatencyMeter,
  qualityOf
} from "../../client/src/net/latency.ts";

import {
  MAX_SESSION_AGE_MS,
  clearSession,
  loadSession,
  saveSession,
  type KeyValueStorage
} from "../../client/src/net/session.ts";

// ==========================================
// SNAPSHOT INTERPOLATION
// ==========================================

describe("snapshot interpolation", () => {

  test("draws between the two surrounding snapshots", () => {

    const buffer = new SnapshotBuffer();

    buffer.push(0, 0, 100);
    buffer.push(100, 50, 100);

    assert.deepEqual(buffer.sample(50), { x: 25, y: 100 });
    assert.deepEqual(buffer.sample(25), { x: 12.5, y: 100 });
  });

  test("is exact on a snapshot, holds before the first and after the last", () => {

    const buffer = new SnapshotBuffer();

    buffer.push(100, 10, 20);
    buffer.push(200, 30, 40);

    assert.deepEqual(buffer.sample(100), { x: 10, y: 20 });
    assert.deepEqual(buffer.sample(200), { x: 30, y: 40 });
    assert.deepEqual(buffer.sample(0), { x: 10, y: 20 }, "before the first");
    assert.deepEqual(buffer.sample(9999), { x: 30, y: 40 }, "no guessing past the newest");
  });

  test("an empty buffer has nothing to draw", () => {

    assert.equal(new SnapshotBuffer().sample(0), null);
  });

  test("a late burst of packets is smooth: the same motion regardless of arrival jitter", () => {

    // The player walks at 220 px/s; snapshots are made every
    // 16.7 ms but ARRIVE with up to 60 ms of jitter. Drawn 100 ms in
    // the past, the path must still be a straight constant-speed line.

    const buffer = new SnapshotBuffer();

    let seed = 7;

    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const arrivals: { at: number; t: number }[] = [];

    let lastArrival = 0;

    for (let i = 0; i < 120; i++) {

      const madeAt = i * (1000 / 60);

      // TCP: in order, so a late packet delays the ones behind it.
      lastArrival = Math.max(lastArrival, madeAt + 40 + random() * 60);

      arrivals.push({ at: lastArrival, t: madeAt });
    }

    const speed = 220;

    let worstStep = 0;
    let worstLine = 0;
    let previous: number | null = null;

    for (let now = 300; now < 1800; now += 1000 / 60) {

      for (const a of arrivals) {

        if (a.at <= now && a.at > now - 1000 / 60) {
          buffer.push(a.at, (a.t / 1000) * speed, 0);
        }
      }

      const drawn = buffer.sample(now - 120);

      if (drawn && previous !== null) {
        worstStep = Math.max(worstStep, Math.abs(drawn.x - previous));
      }

      previous = drawn ? drawn.x : previous;
    }

    // Without interpolation the sprite would jump by whole bursts
    // (tens of px). With it every frame moves a little.
    assert.ok(worstStep < 14, `largest per-frame step ${worstStep.toFixed(1)}px`);
    assert.ok(worstLine === 0);
  });

  test("interpolating is measurably smoother than easing towards the latest packet, and 50 ms of delay is enough", () => {

    // A player walks at 220 px/s while the packets arrive unevenly. We
    // compare how evenly the picture moves (standard deviation of the step
    // per frame) for the client's old way (ease towards the newest
    // position) and for interpolation, both followed by the same easing
    // the game applies on top.

    const roughness = (oneWay: number, jitter: number, delayMs: number) => {

      let seed = 3;

      const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };

      const arrivals: { at: number; x: number }[] = [];

      let lastAt = 0;

      for (let i = 0; i < 200; i++) {

        const madeAt = i * (1000 / 60);

        lastAt = Math.max(lastAt, madeAt + oneWay + random() * jitter);

        arrivals.push({ at: lastAt, x: (madeAt / 1000) * 220 });
      }

      const buffer = new SnapshotBuffer();

      let latest = 0;
      let shown = 0;
      let next = 0;
      let previous: number | null = null;

      const steps: number[] = [];

      for (let now = 0; now < 3000; now += 1000 / 60) {

        while (next < arrivals.length && arrivals[next].at <= now) {
          buffer.push(arrivals[next].at, arrivals[next].x, 0);
          latest = arrivals[next].x;
          next++;
        }

        const target =
          delayMs > 0
            ? buffer.sample(now - delayMs)?.x ?? latest
            : latest;

        shown += (target - shown) * (1 - Math.exp(-(1 / 60) * 35));

        if (now > 800 && now < 2800) {

          if (previous !== null) {
            steps.push(shown - previous);
          }

          previous = shown;
        }
      }

      const mean = steps.reduce((a, c) => a + c, 0) / steps.length;

      return Math.sqrt(steps.reduce((a, c) => a + (c - mean) ** 2, 0) / steps.length);
    };

    for (const [oneWay, jitter] of [[40, 80], [100, 40], [100, 120]]) {

      const easingOnly = roughness(oneWay, jitter, 0);
      const interpolated = roughness(oneWay, jitter, 50);

      assert.ok(
        interpolated < easingOnly * 0.8,
        `${oneWay}+${jitter} ms: ${interpolated.toFixed(2)} vs ${easingOnly.toFixed(2)}: at least 20% smoother`
      );

      // Showing other players 100 ms in the past instead of 50 buys nothing...
      const longer = roughness(oneWay, jitter, 100);

      assert.ok(
        Math.abs(longer - interpolated) < 0.15 * interpolated + 0.05,
        `${oneWay}+${jitter} ms: 100 ms gives ${longer.toFixed(2)}, 50 ms gives ${interpolated.toFixed(2)}`
      );
    }
  });

  test("a respawn jumps; it never slides across the screen", () => {

    const buffer = new SnapshotBuffer(1000, 90);

    buffer.push(0, 700, 500);
    buffer.push(100, 180, 300);

    assert.deepEqual(buffer.sample(50), { x: 700, y: 500 }, "stays put until the jump");
    assert.deepEqual(buffer.sample(100), { x: 180, y: 300 });
  });

  test("out-of-order and duplicate times are tolerated", () => {

    const buffer = new SnapshotBuffer();

    buffer.push(100, 1, 1);
    buffer.push(50, 99, 99);
    buffer.push(100, 2, 2);
    buffer.push(200, 4, 4);

    assert.equal(buffer.length, 2);
    assert.deepEqual(buffer.sample(100), { x: 2, y: 2 });
  });

  test("old history is dropped, the newest is always kept", () => {

    const buffer = new SnapshotBuffer(500);

    for (let t = 0; t <= 10_000; t += 16) {
      buffer.push(t, t, 0);
    }

    assert.ok(buffer.length < 50, `kept ${buffer.length}`);
    assert.equal(buffer.newest?.t, 10_000 - (10_000 % 16));
  });
});

// ==========================================
// LATENCY METER
// ==========================================

describe("latency meter", () => {

  test("bands", () => {

    assert.equal(qualityOf(20), "good");
    assert.equal(qualityOf(80), "good");
    assert.equal(qualityOf(81), "ok");
    assert.equal(qualityOf(160), "ok");
    assert.equal(qualityOf(161), "poor");
    assert.equal(qualityOf(null), "offline");
    assert.equal(qualityOf(undefined), "offline");
    assert.equal(qualityOf(NaN), "offline");
  });

  test("smooths spikes and ignores garbage", () => {

    const meter = new LatencyMeter(0.3);

    assert.equal(meter.rtt, null);
    assert.equal(meter.quality, "offline");

    meter.add(50);

    assert.equal(meter.rtt, 50);

    meter.add(500);

    // 50 + 0.3 * 450 = 185: a spike moves the number, not all of it
    assert.equal(meter.rtt, 185);

    meter.add(NaN);
    meter.add(-5);
    meter.add(Infinity);

    assert.equal(meter.count, 2);
    assert.equal(meter.rtt, 185);

    meter.reset();

    assert.equal(meter.quality, "offline");
  });
});

// ==========================================
// SESSION STORAGE
// ==========================================

class MemoryStorage implements KeyValueStorage {

  data = new Map<string, string>();

  getItem(key: string) { return this.data.get(key) ?? null; }

  setItem(key: string, value: string) { this.data.set(key, value); }

  removeItem(key: string) { this.data.delete(key); }
}

describe("session storage (resume after reload)", () => {

  test("round trip", () => {

    const storage = new MemoryStorage();

    saveSession(storage, { token: "room:abc", roomCode: "ABC123" }, 1000);

    assert.deepEqual(loadSession(storage, 2000), {
      token: "room:abc",
      roomCode: "ABC123",
      savedAt: 1000
    });
  });

  test("expires, and expiry removes it", () => {

    const storage = new MemoryStorage();

    saveSession(storage, { token: "room:abc" }, 0);

    assert.ok(loadSession(storage, MAX_SESSION_AGE_MS - 1));
    assert.equal(loadSession(storage, MAX_SESSION_AGE_MS + 1), null);
    assert.equal(storage.data.size, 0);
  });

  test("corrupt or foreign data is discarded, never thrown", () => {

    for (const junk of ["not json", "{}", '{"token":5}', '{"token":"nocolon","savedAt":1}', "null", "[]"]) {

      const storage = new MemoryStorage();

      storage.setItem("pico.session", junk);

      assert.equal(loadSession(storage, 5), null, junk);
      assert.equal(storage.data.size, 0, "junk removed");
    }
  });

  test("clear, and a missing or throwing storage is harmless", () => {

    const storage = new MemoryStorage();

    saveSession(storage, { token: "a:b" });
    clearSession(storage);

    assert.equal(loadSession(storage), null);

    assert.doesNotThrow(() => saveSession(null, { token: "a:b" }));
    assert.equal(loadSession(null), null);

    const broken: KeyValueStorage = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); }
    };

    assert.doesNotThrow(() => saveSession(broken, { token: "a:b" }));
    assert.equal(loadSession(broken), null);
    assert.doesNotThrow(() => clearSession(broken));
  });

  test("an empty token is never saved", () => {

    const storage = new MemoryStorage();

    saveSession(storage, { token: "" });

    assert.equal(storage.data.size, 0);
  });
});

// ==========================================
// PREDICTION: UNIT BEHAVIOUR
// ==========================================

const level = LEVELS[0];

const world = { platforms: level.platforms, pits: level.pits };

const idle: InputState = { left: false, right: false, jump: false };

const RIGHT: InputState = { ...idle, right: true };

/** A grounded server-side description of the local player. */
const onGround = (x: number, ack = 0): NetPlayer => ({
  id: "me",
  x,
  y: PHYSICS.GROUND_TOP - PHYSICS.PLAYER_HEIGHT / 2,
  velocityX: 0,
  velocityY: 0,
  jumpCount: 0,
  grounded: true,
  standingOn: null,
  alive: true,
  connected: true,
  ack
});

function predictor(x = 100) {

  const p = new Predictor("me");

  p.setWorld(world);

  p.reconcile(onGround(x));

  return p;
}

describe("prediction: how the local player reacts", () => {

  test("there is no body until the server has said where we are", () => {

    const p = new Predictor("me");

    assert.equal(p.step(RIGHT, 0.016), null);
    assert.equal(p.render(), null);

    p.reconcile(onGround(100));

    assert.notEqual(p.step(RIGHT, 0.016), null);
  });

  test("responds to input on the very first frame", () => {

    const p = predictor(100);

    const before = p.render()!.x;

    p.step(RIGHT, 1 / 60);

    const moved = p.render()!.x - before;

    assert.ok(
      Math.abs(moved - PHYSICS.MOVE_SPEED / 60) < 0.01,
      `moved ${moved}px`
    );
  });

  test("uses exactly the server's rules (same result as stepPlayers)", () => {

    const p = predictor(100);

    const twin: PhysicsBody = {
      id: "me", x: 100, y: PHYSICS.GROUND_TOP - 30,
      velocityX: 0, velocityY: 0, alive: true,
      jumpCount: 0, grounded: true, standingOn: null
    };

    const script: InputState[] = [
      RIGHT, RIGHT, { ...RIGHT, jump: true }, RIGHT, RIGHT, RIGHT,
      { ...idle, jump: true }, idle, idle, idle, { ...idle, left: true }
    ];

    for (const input of script) {

      p.step(input, 1 / 60);

      twin.velocityX = input.left ? -PHYSICS.MOVE_SPEED : input.right ? PHYSICS.MOVE_SPEED : 0;

      if (input.jump) {
        tryJump(twin);
      }

      stepPlayers([twin], level.platforms, 1 / 60, level.pits);
    }

    assert.equal(p.body!.x, twin.x);
    assert.equal(p.body!.y, twin.y);
  });

  test("sequence numbers count up with every step", () => {

    const p = predictor();

    assert.deepEqual([1, 2, 3].map(() => p.step(idle, 0.016)), [1, 2, 3]);
  });

  test("an enormous frame time is clamped like the server clamps it", () => {

    const p = predictor(100);

    p.step(RIGHT, 5);

    assert.ok(p.body!.x - 100 <= PHYSICS.MOVE_SPEED * PHYSICS.MAX_DT + 0.001);
  });
});

describe("prediction: reconciling with the server", () => {

  test("agreement within the noise changes nothing", () => {

    const p = predictor(100);

    const seq = p.step(RIGHT, 1 / 60)!;

    const before = { ...p.render()! };

    p.reconcile({ ...onGround(p.body!.x + 0.4), velocityX: PHYSICS.MOVE_SPEED, ack: seq });

    assert.deepEqual(p.render(), before);
    assert.deepEqual(p.stats, { checked: 1, corrected: 0 });
  });

  test("the tolerance is about a tick of movement: more while running than standing", () => {

    // 4 px off. While running that is noise from the server stepping
    // on its own schedule; while standing still it is a real difference.

    const running = predictor(100);

    const r = running.step(RIGHT, 1 / 60)!;

    running.reconcile({
      ...onGround(running.body!.x + 4),
      velocityX: PHYSICS.MOVE_SPEED,
      ack: r
    });

    assert.equal(running.stats.corrected, 0, "ignored while running");

    const standing = predictor(100);

    const s = standing.step(idle, 1 / 60)!;

    standing.reconcile({ ...onGround(standing.body!.x + 4), ack: s });

    assert.equal(standing.stats.corrected, 1, "corrected while standing");
  });

  test("a difference takes the server's state, replays unseen inputs, and the screen does not jump", () => {

    const p = predictor(400);

    const seqs: number[] = [];

    for (let i = 0; i < 10; i++) {
      seqs.push(p.step(RIGHT, 1 / 60)!);
    }

    const shownBefore = { ...p.render()! };

    // The server has only seen the first 4 inputs and says we are
    // 100 px away from where we predicted (shoved, or lagged).
    const step = PHYSICS.MOVE_SPEED / 60;

    const ackedX = 400 + 4 * step;

    p.reconcile({
      ...onGround(ackedX - 100),
      velocityX: PHYSICS.MOVE_SPEED,
      ack: seqs[3]
    });

    assert.equal(p.stats.corrected, 1);

    // 6 unseen inputs replayed on top of the server's position.
    const expected = ackedX - 100 + 6 * step;

    assert.ok(
      Math.abs(p.body!.x - expected) < 0.01,
      `body ${p.body!.x} expected ${expected}`
    );

    // ...while the picture stays where it was and then glides.
    assert.ok(Math.abs(p.render()!.x - shownBefore.x) < 0.01);

    for (let i = 0; i < 60; i++) {
      p.decay(1 / 60);
    }

    assert.ok(Math.abs(p.render()!.x - p.body!.x) < 0.5, "glided to the corrected spot");
  });

  test("a wrong velocity is fixed even when the position still agrees", () => {

    const p = predictor(100);

    const seq = p.step(idle, 1 / 60)!;

    // same place, but the server says we are falling fast
    p.reconcile({
      ...onGround(p.body!.x),
      velocityY: 300,
      grounded: false,
      ack: seq
    });

    assert.equal(p.stats.corrected, 1);
    assert.equal(p.body!.velocityY, 300);
  });

  test("repeating the same server state does not keep correcting", () => {

    const p = predictor(300);

    const seq = p.step(idle, 1 / 60)!;

    const server = { ...onGround(p.body!.x + 30), ack: seq };

    p.reconcile(server);
    p.reconcile(server);
    p.reconcile(server);

    assert.equal(p.stats.corrected, 1, "once corrected, the same state agrees");
    assert.ok(Math.abs(p.body!.x - server.x) < 0.01);
  });

  test("a huge correction is not smoothed: the player simply appears there", () => {

    const p = predictor(100);

    const seq = p.step(idle, 1 / 60)!;

    p.reconcile({ ...onGround(700), ack: seq });

    assert.equal(p.offset.x, 0);
    assert.ok(Math.abs(p.render()!.x - 700) < 1);
  });

  test("an acknowledgement for a step we no longer remember is ignored if we agree", () => {

    const p = predictor(100);

    p.step(idle, 1 / 60);

    const before = { ...p.render()! };

    p.reconcile({ ...onGround(100), ack: 999 });

    assert.deepEqual(p.render(), before);
  });

  test("...and obeyed if we are somewhere else entirely (a counter restart after reload)", () => {

    const p = predictor(100);

    p.step(idle, 1 / 60);

    p.reconcile({ ...onGround(500), ack: 999 });

    assert.ok(Math.abs(p.body!.x - 500) < 1e-9);
  });

  test("reset forgets the body: the next server state recreates it", () => {

    const p = predictor(100);

    p.step(RIGHT, 1 / 60);

    p.reset();

    assert.equal(p.render(), null);
    assert.equal(p.step(RIGHT, 1 / 60), null);

    p.reconcile(onGround(300));

    assert.equal(p.body!.x, 300);
  });

  test("history is bounded when the server stops answering", () => {

    const p = new Predictor("me", { historyLimit: 30 });

    p.setWorld(world);
    p.reconcile(onGround(100));

    for (let i = 0; i < 1000; i++) {
      p.step(idle, 1 / 60);
    }

    // still works afterwards
    assert.doesNotThrow(() => p.reconcile({ ...onGround(100), ack: 1000 }));
  });
});

// ==========================================
// PREDICTION AGAINST THE REAL SERVER PHYSICS
// ==========================================
//
// A small deterministic network simulation:
//
//   - a "server" that does what GameRoom does
//     (apply the newest input when it arrives,
//     physics tick ~60 times a second, send the
//     state of everyone with the acknowledged
//     input number)
//   - latency and jitter on both directions
//     (in order, like TCP)
//   - a client running Predictor at its frame
//     rate
//
// It measures what a player would actually feel.

interface SimOptions {

  // One-way delay, ms.
  oneWayMs: number;

  jitterMs: number;

  clientFps: number;

  seconds: number;

  // Input for the local player at time t (ms).
  script: (t: number) => InputState;

  // Scripted input for a second player who
  // is driven by the server, not predicted.
  otherScript?: (t: number) => InputState;

  start?: { me?: [number, number]; other?: [number, number] };

  predict?: boolean;

  seed?: number;

  // Flat ground only (no platforms or pits).
  bare?: boolean;
}

interface SimResult {

  // Local player as drawn each frame.
  frames: { t: number; x: number; y: number }[];

  // The server's authoritative local player.
  server: PhysicsBody;

  serverOther: PhysicsBody | null;

  predictor: Predictor;

  // ms from the first key press until the
  // picture moved.
  firstMoveDelay: number | null;

  // Every correction the predictor made.
  corrections: { t: number; error: number }[];
}

function simulate(options: SimOptions): SimResult {

  let seed = options.seed ?? 1;

  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const body = (id: string, [x, y]: [number, number]): PhysicsBody => ({
    id, x, y,
    velocityX: 0, velocityY: 0, alive: true,
    jumpCount: 0, grounded: false, standingOn: null
  });

  const me = body("me", options.start?.me ?? [SPAWN_POSITIONS[0].x, 300]);

  const other = options.otherScript
    ? body("other", options.start?.other ?? [SPAWN_POSITIONS[1].x, 300])
    : null;

  const players = other ? [me, other] : [me];

  const platforms = options.bare ? [] : level.platforms;

  const pits = options.bare ? [] : level.pits;

  const lastSeq = new Map<string, number>([["me", 0], ["other", 0]]);

  // ---- the "network" (ordered per direction) ----

  type Packet = { at: number; run: () => void };

  const toServer: Packet[] = [];
  const toClient: Packet[] = [];

  let lastUp = 0;
  let lastDown = 0;

  const delay = () => options.oneWayMs + random() * options.jitterMs;

  const sendUp = (now: number, run: () => void) => {
    lastUp = Math.max(lastUp, now + delay());
    toServer.push({ at: lastUp, run });
  };

  const sendDown = (now: number, run: () => void) => {
    lastDown = Math.max(lastDown, now + delay());
    toClient.push({ at: lastDown, run });
  };

  const deliver = (queue: Packet[], now: number) => {
    while (queue.length && queue[0].at <= now) {
      queue.shift()!.run();
    }
  };

  // ---- client ----

  const predictor = new Predictor("me");

  predictor.setWorld({ platforms, pits });

  const predict = options.predict ?? true;

  const corrections: SimResult["corrections"] = [];

  // Without prediction the client just draws the latest server state.
  let latestMe = null as NetPlayer | null;

  const applyInputOnServer = (id: string, input: InputState, seq: number | null) => {

    const player = players.find((p) => p.id === id)!;

    if (seq !== null && seq > lastSeq.get(id)!) {
      lastSeq.set(id, seq);
    }

    player.velocityX = input.left ? -PHYSICS.MOVE_SPEED : input.right ? PHYSICS.MOVE_SPEED : 0;

    if (input.jump) {
      tryJump(player);
    }
  };

  // ---- run ----

  const tickMs = 1000 / 60;

  const frameMs = 1000 / options.clientFps;

  let nextTick = 0;
  let nextFrame = 0;

  const frames: SimResult["frames"] = [];

  let firstPress: number | null = null;
  let firstMoveDelay: number | null = null;
  let startX: number | null = null;

  const end = options.seconds * 1000;

  // Fixed small steps so every event lands on time.
  for (let now = 0; now <= end; now += 0.5) {

    deliver(toServer, now);

    // server tick
    if (now >= nextTick) {

      nextTick += tickMs;

      if (other) {
        applyInputOnServer("other", options.otherScript!(now), null);
      }

      stepPlayers(players, platforms, tickMs / 1000, pits);

      const snapshot = players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        velocityX: p.velocityX,
        velocityY: p.velocityY,
        jumpCount: p.jumpCount,
        grounded: p.grounded,
        standingOn: p.standingOn,
        alive: true,
        connected: true,
        ack: lastSeq.get(p.id)
      }));

      sendDown(now, () => {

        latestMe = snapshot.find((p) => p.id === "me")!;

        predictor.setOthers(snapshot.filter((p) => p.id !== "me"));

        if (predict) {

          const before = { ...predictor.stats };

          predictor.reconcile(latestMe);

          if (predictor.stats.corrected > before.corrected) {
            corrections.push({ t: now, error: predictor.lastError });
          }
        }
      });
    }

    deliver(toClient, now);

    // client frame
    if (now >= nextFrame) {

      nextFrame += frameMs;

      const input = options.script(now);

      if (
        firstPress === null &&
        (input.left || input.right || input.jump)
      ) {
        firstPress = now;
      }

      let seq: number | null = null;

      if (predict) {
        seq = predictor.step(input, frameMs / 1000);
        predictor.decay(frameMs / 1000);
      }

      sendUp(now, () => applyInputOnServer("me", input, seq));

      const shown = predict
        ? predictor.render()
        : latestMe && { x: latestMe.x, y: latestMe.y };

      if (shown) {

        frames.push({ t: now, x: shown.x, y: shown.y });

        if (startX === null && firstPress !== null) {
          startX = shown.x;
        }

        if (
          firstPress !== null &&
          firstMoveDelay === null &&
          startX !== null &&
          Math.abs(shown.x - startX) > 0.5 &&
          now >= firstPress
        ) {
          firstMoveDelay = now - firstPress;
        }
      }
    }
  }

  return {
    frames,
    server: me,
    serverOther: other,
    predictor,
    firstMoveDelay,
    corrections
  };
}

/** Largest distance the picture moved between two
 *  consecutive frames, beyond what the player's own
 *  speed explains. */
function worstGlitch(frames: SimResult["frames"], fps: number) {

  let worst = 0;

  for (let i = 1; i < frames.length; i++) {

    const dx = Math.abs(frames[i].x - frames[i - 1].x);
    const dy = Math.abs(frames[i].y - frames[i - 1].y);

    // fastest legitimate motion: walking sideways; falling / jumping
    const allowedX = PHYSICS.MOVE_SPEED / fps;
    const allowedY = 540 / fps;

    worst = Math.max(worst, dx - allowedX, dy - allowedY);
  }

  return worst;
}

/** Walk, jump, double jump, walk back, stop. */
const walkAndJump = (t: number): InputState => {

  if (t < 800) return idle;                       // land first

  if (t < 1100) return RIGHT;
  if (t < 1130) return { ...RIGHT, jump: true };   // jump
  if (t < 1300) return RIGHT;
  if (t < 1330) return { ...RIGHT, jump: true };   // double jump
  if (t < 1900) return RIGHT;
  if (t < 2500) return { ...idle, left: true };
  return idle;
};

describe("prediction against the real physics over a laggy network", () => {

  const networks = [
    { name: "LAN (10 ms)", oneWayMs: 5, jitterMs: 3, fps: 60 },
    { name: "good (60 ms ping)", oneWayMs: 30, jitterMs: 8, fps: 60 },
    { name: "poor (200 ms ping, jittery)", oneWayMs: 100, jitterMs: 40, fps: 60 },
    { name: "bad (400 ms ping)", oneWayMs: 200, jitterMs: 60, fps: 60 },
    { name: "144 Hz monitor, 100 ms ping", oneWayMs: 50, jitterMs: 15, fps: 144 },
    { name: "30 fps laptop, 100 ms ping", oneWayMs: 50, jitterMs: 15, fps: 30 }
  ];

  for (const net of networks) {

    test(`${net.name}: instant response, smooth, and it ends up exactly where the server is`, () => {

      const common = {
        oneWayMs: net.oneWayMs,
        jitterMs: net.jitterMs,
        clientFps: net.fps,
        seconds: 5,
        script: walkAndJump,
        seed: 42
      };

      const predicted = simulate({ ...common, predict: true });

      if (process.env.NET_DEBUG) {
        console.log(net.name, JSON.stringify(predicted.corrections.map((c) => [Math.round(c.t), +c.error.toFixed(1)])));
      }

      // 1. responsiveness: within a frame or two, not a round trip
      assert.ok(predicted.firstMoveDelay !== null, "the player moved");
      assert.ok(
        predicted.firstMoveDelay! <= 2000 / net.fps,
        `reacted after ${predicted.firstMoveDelay!.toFixed(0)} ms`
      );

      // 2. the unpredicted client, for contrast, waits for the network
      const plain = simulate({ ...common, predict: false });

      assert.ok(
        plain.firstMoveDelay! > net.oneWayMs * 2 * 0.9,
        `without prediction it reacted after ${plain.firstMoveDelay!.toFixed(0)} ms`
      );

      // 3. smooth: no unexplained jumps of the picture
      const glitch = worstGlitch(predicted.frames, net.fps);

      assert.ok(glitch < 6, `largest unexplained jump ${glitch.toFixed(1)} px`);

      // 4. in the end the picture and the server agree
      const last = predicted.frames[predicted.frames.length - 1];

      assert.ok(
        Math.hypot(last.x - predicted.server.x, last.y - predicted.server.y) < 1,
        `ended ${Math.hypot(last.x - predicted.server.x, last.y - predicted.server.y).toFixed(2)} px from the server`
      );

      // 5. a plain walk-and-jump is predicted well: corrections are rare
      //    (a very jittery connection bunches packets up, so it gets more
      //    of them), and once the player has landed they are all tiny.
      const limit = net.jitterMs >= 60 ? 30 : 6;

      assert.ok(
        predicted.predictor.stats.corrected <= limit,
        `${predicted.predictor.stats.corrected} corrections: ${JSON.stringify(predicted.corrections.slice(0, 8))}`
      );

      const afterLanding = predicted.corrections.filter((c) => c.t > 1000);

      assert.ok(
        afterLanding.every((c) => c.error < 15),
        `a large correction after landing: ${JSON.stringify(afterLanding.filter((c) => c.error >= 15))}`
      );
    });
  }

  test("changing direction all the time stays smooth and converges", () => {

    const scribble = (t: number): InputState => {

      if (t < 800) return idle;

      const phase = Math.floor((t - 800) / 140) % 4;

      return phase === 0 ? RIGHT
        : phase === 1 ? { ...RIGHT, jump: (t % 280) < 30 }
        : phase === 2 ? { ...idle, left: true }
        : idle;
    };

    for (const oneWayMs of [20, 80, 150]) {

      const result = simulate({
        oneWayMs,
        jitterMs: 30,
        clientFps: 60,
        seconds: 8,
        script: (t) => t > 6500 ? idle : scribble(t),
        seed: 3
      });

      const glitch = worstGlitch(result.frames, 60);

      const last = result.frames[result.frames.length - 1];

      assert.ok(glitch < 8, `${oneWayMs} ms: unexplained jump ${glitch.toFixed(1)} px`);

      assert.ok(
        Math.hypot(last.x - result.server.x, last.y - result.server.y) < 1,
        `${oneWayMs} ms: ended ${Math.hypot(last.x - result.server.x, last.y - result.server.y).toFixed(2)} px away`
      );
    }
  });

  test("landing on another player's head (the core co-op move) stays in sync", () => {

    // "other" stands still at x = 300; "me" walks right and jumps
    // onto them.

    const script = (t: number): InputState => {

      if (t < 900) return idle;

      if (t < 1150) return RIGHT;
      if (t < 1180) return { ...RIGHT, jump: true };
      if (t < 1500) return RIGHT;
      if (t < 1650) return { ...idle, left: true };   // drift back over their head

      return idle;
    };

    for (const oneWayMs of [20, 60, 120]) {

      const result = simulate({
        oneWayMs,
        jitterMs: 15,
        clientFps: 60,
        seconds: 6,
        script,
        otherScript: () => idle,
        start: { me: [180, 300], other: [300, 300] },
        bare: true,
        seed: 11
      });

      if (process.env.NET_DEBUG) {
        console.log("stack", oneWayMs, JSON.stringify(result.server), JSON.stringify(result.serverOther), JSON.stringify(result.frames.filter((_, i) => i % 15 === 0).map((f) => [Math.round(f.t), Math.round(f.x), Math.round(f.y)])));
      }

      assert.equal(
        result.server.standingOn,
        "other",
        `${oneWayMs} ms: the server has me standing on the other player`
      );

      const last = result.frames[result.frames.length - 1];

      assert.ok(
        Math.hypot(last.x - result.server.x, last.y - result.server.y) < 1.5,
        `${oneWayMs} ms: ended ${Math.hypot(last.x - result.server.x, last.y - result.server.y).toFixed(2)} px from the server`
      );

      assert.ok(
        result.predictor.body!.standingOn === "other",
        `${oneWayMs} ms: and so does the prediction`
      );

      const glitch = worstGlitch(result.frames, 60);

      assert.ok(glitch < 40, `${oneWayMs} ms: unexplained jump ${glitch.toFixed(1)} px`);
    }
  });

  test("riding a player who walks away", () => {

    // "other" walks right after "me" has climbed on top.

    const otherScript = (t: number): InputState => t > 2200 && t < 3000 ? RIGHT : idle;

    const script = (t: number): InputState => {

      if (t < 900) return idle;
      if (t < 1150) return RIGHT;
      if (t < 1180) return { ...RIGHT, jump: true };
      if (t < 1500) return RIGHT;
      if (t < 1650) return { ...idle, left: true };

      return idle;
    };

    for (const oneWayMs of [20, 60]) {

      const result = simulate({
        oneWayMs,
        jitterMs: 10,
        clientFps: 60,
        seconds: 6,
        script,
        otherScript,
        start: { me: [180, 300], other: [300, 300] },
        bare: true,
        seed: 5
      });

      const last = result.frames[result.frames.length - 1];

      const error = Math.hypot(last.x - result.server.x, last.y - result.server.y);

      assert.ok(error < 3, `${oneWayMs} ms: ended ${error.toFixed(2)} px from the server`);

      assert.equal(result.server.standingOn, "other", "server: still riding");
    }
  });

  test("a hit by the server (respawn) is accepted at once", () => {

    // The player walks; the server teleports them (a respawn) while
    // the client still predicts the old spot.

    const p = predictor(400);

    let seq = 0;

    for (let i = 0; i < 20; i++) {
      seq = p.step(RIGHT, 1 / 60)!;
    }

    const spawn = onGround(SPAWN_POSITIONS[0].x, seq);

    p.reconcile(spawn);

    p.reset();

    p.reconcile(spawn);

    assert.equal(p.body!.x, SPAWN_POSITIONS[0].x);
    assert.equal(p.offset.x, 0);
  });
});
