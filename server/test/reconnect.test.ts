import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import type { App } from "../src/app.js";

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

let open: Bot[] = [];

const track = <T extends Bot>(bot: T): T => {
  open.push(bot);
  return bot;
};

before(async () => {
  app = await startApp();
});

afterEach(async () => {

  delete process.env.RECONNECT_WINDOW_SECONDS;

  await Promise.all(open.map((b) => b.leave()));

  open = [];
});

after(async () => {
  await app.close();
});

/** Lobby with `n` players, nobody ready yet. */
async function lobby(n = 2) {

  const host = track(await createRoom(app));

  const others: Bot[] = [];

  for (let i = 1; i < n; i++) {
    others.push(track(await joinRoom(app, host)));
  }

  await waitFor(
    () => host.count("playerJoined") === n - 1,
    "host sees everyone"
  );

  return { host, others, all: [host, ...others] };
}

/** A started game with `n` players. */
async function game(n = 2) {

  const { host, others, all } = await lobby(n);

  await startGame(host, others);

  return { host, others, all };
}

const droppedEvent = (observer: Bot, who: Bot) =>
  observer.events.find(
    (e) => e.type === "playerDropped" && e.data.id === who.id
  );

/** Drops `who` and waits until the server noticed. */
async function dropAndWait(observer: Bot, who: Bot) {

  who.drop();

  await waitFor(() => droppedEvent(observer, who), "server notices the drop");
}

/** Drops `who` for good: the client library does not
 *  retry. The seat is held for `windowSeconds`. */
async function dropForGood(observer: Bot, who: Bot, windowSeconds = 4) {

  process.env.RECONNECT_WINDOW_SECONDS = String(windowSeconds);

  who.room.reconnection.enabled = false;

  await dropAndWait(observer, who);
}

const reconnected = (who: Bot, times = 1) =>
  waitFor(() => who.reconnects >= times, "client reconnects", 8000);

// ==========================================
// LOBBY
// ==========================================

describe("reconnecting in the lobby", () => {

  test("a dropped player keeps the seat, and comes back with a full resync", async () => {

    const { host, others } = await lobby(2);

    const guest = others[0];

    const sessionBefore = guest.id;

    guest.room.send("toggleReady");

    await waitFor(() => serverRoom(host).players.get(guest.id)?.ready, "guest ready");

    await dropAndWait(host, guest);

    assert.equal(
      serverRoom(host).players.get(guest.id).connected,
      false,
      "marked as away"
    );

    assert.equal(host.count("playerLeft"), 0, "a drop is not a leave");

    await reconnected(guest);

    assert.equal(guest.id, sessionBefore, "same session, same seat");

    const resync = await waitFor(() => guest.last("resync"), "resync");

    assert.equal(resync.roomCode, host.roomCode);
    assert.equal(resync.hostId, host.id);
    assert.equal(resync.gameStarted, false);
    assert.equal(resync.level, null, "no level before the game starts");
    assert.equal(resync.players.length, 2);

    const me = resync.players.find((p: any) => p.id === guest.id);

    assert.equal(me.ready, true, "ready state survives the drop");
    assert.equal(me.connected, true);

    await waitFor(
      () => host.events.find((e) => e.type === "playerReconnected" && e.data.id === guest.id),
      "host told the guest is back"
    );

    assert.equal(host.count("playerLeft"), 0);
  });

  test("messages work again after coming back", async () => {

    const { host, others } = await lobby(2);

    const guest = others[0];

    await dropAndWait(host, guest);
    await reconnected(guest);

    guest.room.send("toggleReady");

    await waitFor(
      () => serverRoom(host).players.get(guest.id).ready === true,
      "the returned player can act"
    );
  });

  test("a player who is away does not hold up the start", async () => {

    const { host, others } = await lobby(2);

    const guest = others[0];

    host.room.send("toggleReady");

    await waitFor(() => serverRoom(host).players.get(host.id).ready, "host ready");

    assert.equal(serverRoom(host).areAllPlayersReady(), false, "guest not ready yet");

    await dropAndWait(host, guest);

    assert.equal(serverRoom(host).areAllPlayersReady(), true, "only connected players count");

    host.room.send("startGame");

    await waitFor(() => host.count("gameStarted") === 1, "game starts without the absent player");
  });

  test("the host role passes to a connected player at once, and stays there", async () => {

    const { host, others } = await lobby(3);

    const [second, third] = others;

    await dropAndWait(second, host);

    await waitFor(() => second.hostId === second.id, "second player becomes host");

    assert.equal(third.hostId, second.id);

    await reconnected(host);

    await waitFor(() => host.last("resync"), "resync");

    assert.equal(host.last("resync").hostId, second.id, "the old host does not take it back");

    host.room.send("startGame");

    await sleep(150);

    assert.equal(host.count("gameStarted"), 0, "and cannot start the game any more");
  });

  test("when nobody comes back the seat is released after the window", async () => {

    process.env.RECONNECT_WINDOW_SECONDS = "0.4";

    const { host, others } = await lobby(2);

    const guest = others[0];

    // This client does not retry, so the window runs out.
    guest.room.reconnection.enabled = false;

    await dropAndWait(host, guest);

    assert.equal(host.count("playerLeft"), 0, "still held at first");

    await waitFor(
      () => host.events.find((e) => e.type === "playerLeft" && e.data.id === guest.id),
      "seat released after the window"
    );

    assert.equal(serverRoom(host).players.has(guest.id), false);
  });

  test("the only player can drop and return: the room waits for them", async () => {

    const host = track(await createRoom(app));

    const roomId = host.room.roomId;

    host.drop();

    await waitFor(
      () => serverRoom(host)?.players.get(host.id)?.connected === false,
      "server notices the drop"
    );

    await reconnected(host);

    assert.ok(serverRoom(host), "room still exists");
    assert.equal(host.room.roomId, roomId);
    assert.equal(host.hostId, host.id);
  });

  test("a deliberate leave is still immediate", async () => {

    const { host, others } = await lobby(2);

    await others[0].leave();

    await waitFor(
      () => host.events.find((e) => e.type === "playerLeft"),
      "leave is not delayed by the window"
    );

    assert.equal(host.count("playerDropped"), 0);
  });
});

// ==========================================
// IN A GAME
// ==========================================

describe("reconnecting during a game", () => {

  test("an absent player is frozen, not solid and not counted", async () => {

    const { host, others } = await game(2);

    const guest = others[0];

    await waitFor(() => host.state!.players.every((p) => p.grounded), "everyone landed", 8000);

    await dropForGood(host, guest);

    await waitFor(
      () => host.state!.players.find((p) => p.id === guest.id)?.connected === false,
      "state flags the absent player"
    );

    const frozen = host.state!.players.find((p) => p.id === guest.id)!;

    assert.equal(host.state!.playersNeeded, 1, "the door waits for connected players only");

    // Put the host exactly on the absent player's head. If that body
    // were solid the host would stand on it; it must fall through.
    teleport(host, host, frozen.x, frozen.y - 70);

    await waitFor(
      () => {
        const me = host.me!;
        return me.grounded && me.y > frozen.y - 20;
      },
      "host drops through the empty space to the floor"
    );

    assert.equal(host.me!.standingOn ?? null, null);

    const later = host.state!.players.find((p) => p.id === guest.id)!;

    assert.equal(later.x, frozen.x);
    assert.equal(later.y, frozen.y);
  });

  test("the level can be finished while someone is away", async () => {

    const { host, others } = await game(2);

    const guest = others[0];

    await waitFor(() => host.state!.players.every((p) => p.grounded), "everyone landed", 8000);

    await sleep(100);

    // A long window: the level must be finished while the seat is STILL
    // held, not because it was given up.
    await dropForGood(host, guest, 60);

    for (const crystal of host.level!.crystals) {

      const from = host.events.length;

      teleport(host, host, crystal.x, crystal.y);

      await waitFor(
        () =>
          host.events
            .slice(from)
            .some((e) => e.type === "crystalCollected" && e.data.id === crystal.id) ||
          serverRoom(host).crystals.get(crystal.id).collected,
        `crystal ${crystal.id}`
      );
    }

    await waitFor(() => host.state!.doorOpen, "door open");

    teleport(host, host, host.level!.exit.x, host.level!.exit.y);

    await waitFor(
      () => host.count("levelCompleted") === 1,
      "level completes with the absent player not blocking"
    );

    assert.equal(
      serverRoom(host).players.get(guest.id)?.connected,
      false,
      "the absent player still has their seat (they were not removed to make this work)"
    );
  });

  test("a returning player gets the world as it is now, at their spawn point", async () => {

    const { host, others } = await game(2);

    const guest = others[0];

    await waitFor(() => host.state!.players.every((p) => p.grounded), "everyone landed", 8000);

    await sleep(100);

    await dropAndWait(host, guest);

    // Progress they will have missed.
    const level = host.level!;

    const target = level.crystals.find(
      (c) => !serverRoom(host).crystals.get(c.id).collected
    )!;

    teleport(host, host, target.x, target.y);

    await waitFor(
      () => serverRoom(host).crystals.get(target.id).collected,
      "host collects a crystal while the guest is away"
    );

    const scoreWhileAway = serverRoom(host).score as number;

    await reconnected(guest);

    const resync = await waitFor(() => guest.last("resync"), "resync");

    assert.equal(resync.gameStarted, true);
    assert.equal(resync.gameFinished, false);
    assert.ok(resync.level, "level geometry included");
    assert.equal(resync.level.level, 1);
    assert.equal(resync.level.score, scoreWhileAway, "the missed crystal is counted");
    assert.equal(
      resync.level.crystals.find((c: any) => c.id === target.id).collected,
      true
    );

    const me = resync.players.find((p: any) => p.id === guest.id);

    assert.equal(me.connected, true);

    // Spawn points are x = 180 / 300 / ...: index 1 -> 300.
    assert.equal(me.x, 300);

    await waitFor(
      () => host.state!.players.find((p) => p.id === guest.id)?.connected === true,
      "state says they are back"
    );

    assert.equal(host.state!.playersNeeded, 2);

    // And they can play again.
    const startX = guest.me!.x;

    guest.input = { right: true };

    await waitFor(() => guest.me!.x > startX + 30, "the returned player moves");
  });

  test("the door waits for a returned player again", async () => {

    const { host, others } = await game(2);

    const guest = others[0];

    await waitFor(() => host.state!.players.every((p) => p.grounded), "everyone landed", 8000);

    await dropAndWait(host, guest);
    await reconnected(guest);

    await waitFor(() => host.state!.playersNeeded === 2, "both needed again");

    for (const crystal of host.level!.crystals) {

      if (!serverRoom(host).crystals.get(crystal.id).collected) {

        teleport(host, host, crystal.x, crystal.y);

        await waitFor(
          () => serverRoom(host).crystals.get(crystal.id).collected,
          `crystal ${crystal.id}`
        );
      }
    }

    await waitFor(() => host.state!.doorOpen, "door open");

    teleport(host, host, host.level!.exit.x, host.level!.exit.y);

    await sleep(300);

    assert.equal(host.count("levelCompleted"), 0, "one of two inside is not enough");
  });

  test("dropping twice in a row works", async () => {

    const { host, others } = await game(2);

    const guest = others[0];

    for (let round = 1; round <= 2; round++) {

      await dropAndWait(host, guest);
      await reconnected(guest, round);

      await waitFor(
        () => host.state!.players.find((p) => p.id === guest.id)?.connected === true,
        `back after drop ${round}`
      );
    }

    assert.equal(host.count("playerLeft"), 0);
  });

  test("a finished game does not hold seats", async () => {

    const { host, others } = await game(2);

    serverRoom(host).gameFinished = true;

    others[0].room.reconnection.enabled = false;

    others[0].drop();

    await waitFor(
      () => host.events.find((e) => e.type === "playerLeft"),
      "left at once"
    );

    assert.equal(host.count("playerDropped"), 0);
  });
});

// ==========================================
// INPUT SEQUENCE + LATENCY REPORTS
// ==========================================

describe("input sequence numbers", () => {

  test("the server echoes the newest sequence number it applied", async () => {

    const { host } = await game(1);

    host.stopInput();

    host.room.send("input", { seq: 10 });

    await waitFor(() => host.me!.ack === 10, "ack 10");

    host.room.send("input", { seq: 12 });

    await waitFor(() => host.me!.ack === 12, "ack 12");
  });

  test("an older or invalid sequence number never moves the ack back", async () => {

    const { host } = await game(1);

    host.stopInput();

    host.room.send("input", { seq: 50 });

    await waitFor(() => host.me!.ack === 50, "ack 50");

    for (const bad of [5, -1, NaN, Infinity, "99", null, {}, []]) {
      host.room.send("input", { seq: bad });
    }

    await sleep(200);

    assert.equal(host.me!.ack, 50);
  });

  test("a client that starts counting again (page reload) is accepted", async () => {

    const { host, others } = await game(2);

    const guest = others[0];

    guest.stopInput();

    guest.room.send("input", { seq: 400 });

    await waitFor(() => guest.me!.ack === 400, "ack 400");

    await dropAndWait(host, guest);
    await reconnected(guest);

    guest.room.send("input", { seq: 1 });

    await waitFor(() => guest.me!.ack === 1, "ack restarts after a reconnect");
  });
});

describe("latency reports", () => {

  test("reported round trips are broadcast to everyone, clamped to a sane range", async () => {

    const { host, others } = await lobby(2);

    const guest = others[0];

    guest.room.send("latency", { rtt: 87.4 });

    await waitFor(
      () => host.last("latencies")?.rtts[guest.id] === 87,
      "rounded value broadcast"
    );

    guest.room.send("latency", { rtt: 9_999_999 });

    await waitFor(() => host.last("latencies")?.rtts[guest.id] === 5000, "clamped high");

    guest.room.send("latency", { rtt: -40 });

    await waitFor(() => host.last("latencies")?.rtts[guest.id] === 0, "clamped low");

    guest.room.send("latency", { rtt: "fast" });
    guest.room.send("latency", { rtt: NaN });
    guest.room.send("latency", null);
    guest.room.send("latency");

    await sleep(1200);

    assert.equal(host.last("latencies").rtts[guest.id], 0, "garbage is ignored");
  });

  test("players who left are no longer listed", async () => {

    const { host, others } = await lobby(2);

    const guest = others[0];

    guest.room.send("latency", { rtt: 50 });

    await waitFor(() => host.last("latencies")?.rtts[guest.id] === 50, "listed");

    await guest.leave();

    await waitFor(
      () => host.last("latencies") && !(guest.id in host.last("latencies").rtts),
      "removed"
    );
  });
});
