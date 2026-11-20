import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import type { App } from "../src/app.js";

import { NAME_MAX, PALETTE } from "../src/profile.js";

import {
  Bot,
  createRoom,
  joinRoom,
  serverRoom,
  sleep,
  startApp,
  startGame,
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

  await Promise.all(open.map((b) => b.leave()));

  open = [];
});

after(async () => {
  await app.close();
});

const serverPlayer = (host: Bot, bot: Bot) => serverRoom(host).players.get(bot.id);

describe("choosing a name and colour when joining", () => {

  test("the player's own name and colour are used", async () => {

    const host = track(await createRoom(app, { name: "Aditya", color: 0xaa66ff }));

    assert.equal(serverPlayer(host, host).name, "Aditya");
    assert.equal(serverPlayer(host, host).color, 0xaa66ff);

    // everybody is told, and told again to latecomers
    const me = host.events.find((e) => e.type === "playerJoinedSelf")!.data;

    assert.equal(me.name, "Aditya");
    assert.equal(me.color, 0xaa66ff);

    const guest = track(await joinRoom(app, host, { name: "Sam", color: 0xff8844 }));

    await waitFor(() => host.count("playerJoined") === 1, "host sees guest");

    assert.equal(host.last("playerJoined").name, "Sam");
    assert.equal(host.last("playerJoined").color, 0xff8844);

    const roster = guest.events.filter((e) => e.type === "playerJoined").map((e) => e.data);

    assert.deepEqual(
      roster.map((p) => [p.name, p.color]),
      [["Aditya", 0xaa66ff]],
      "the newcomer is sent the players who were already there, with their profiles"
    );
  });

  test("without choices players get 'Player N' and their seat's colour, as before", async () => {

    const host = track(await createRoom(app));
    const guest = track(await joinRoom(app, host));

    assert.equal(serverPlayer(host, host).name, "Player 1");
    assert.equal(serverPlayer(host, guest).name, "Player 2");
    assert.equal(serverPlayer(host, host).color, PALETTE[0]);
    assert.equal(serverPlayer(host, guest).color, PALETTE[1]);
  });

  test("a name is cleaned on the server, whatever the client sends", async () => {

    const host = track(await createRoom(app, { name: "  <b>Eve</b>   the  great  " }));

    const name = serverPlayer(host, host).name;

    assert.ok(name.length <= NAME_MAX);
    assert.doesNotMatch(name, /[<>]/);
    assert.equal(name, "bEveb the gr", "markup characters removed, spaces tidied, cut to the limit");

    const nasty = track(await joinRoom(app, host, { name: "😀😀<<<>>>" }));

    assert.equal(serverPlayer(host, nasty).name, "Player 2", "nothing usable left: the default");

    for (const junk of [42, null, {}, [], true, "x".repeat(500)]) {

      const bot = track(await createRoom(app, { name: junk as any, color: junk as any }));

      const player = serverPlayer(bot, bot);

      assert.ok(player.name.length >= 1 && player.name.length <= NAME_MAX, String(junk));
      assert.ok((PALETTE as readonly number[]).includes(player.color), String(junk));
    }
  });

  test("two players with the same name get different ones", async () => {

    const host = track(await createRoom(app, { name: "Sam" }));
    const second = track(await joinRoom(app, host, { name: "sam" }));
    const third = track(await joinRoom(app, host, { name: "SAM" }));

    assert.deepEqual(
      [host, second, third].map((b) => serverPlayer(host, b).name),
      ["Sam", "sam 2", "SAM 3"]
    );
  });

  test("two players cannot have the same colour", async () => {

    const host = track(await createRoom(app, { color: 0xff4444 }));
    const second = track(await joinRoom(app, host, { color: 0xff4444 }));
    const third = track(await joinRoom(app, host, { color: 0xff4444 }));
    const fourth = track(await joinRoom(app, host, { color: 0xff4444 }));

    const colors = [host, second, third, fourth].map((b) => serverPlayer(host, b).color);

    assert.equal(new Set(colors).size, 4);
    assert.equal(colors[0], 0xff4444, "the first one to ask gets it");
  });

  test("a colour that is not in the palette is not accepted", async () => {

    const host = track(await createRoom(app, { color: 0x123456 }));

    assert.equal(serverPlayer(host, host).color, PALETTE[0]);
  });

  test("a name and colour are free again when their owner leaves", async () => {

    const host = track(await createRoom(app, { name: "Host", color: 0xff4444 }));
    const guest = track(await joinRoom(app, host, { name: "Sam", color: 0x4488ff }));

    await guest.leave();

    await waitFor(() => serverRoom(host).players.size === 1, "guest gone");

    const again = track(await joinRoom(app, host, { name: "Sam", color: 0x4488ff }));

    assert.equal(serverPlayer(host, again).name, "Sam");
    assert.equal(serverPlayer(host, again).color, 0x4488ff);
  });
});

describe("changing them in the lobby", () => {

  test("a new name and colour reach everyone", async () => {

    const host = track(await createRoom(app, { name: "Host" }));
    const guest = track(await joinRoom(app, host, { name: "Guest" }));

    guest.room.send("setProfile", { name: "Captain", color: 0xff66bb });

    await waitFor(
      () => host.events.find((e) => e.type === "playerProfileChanged" && e.data.id === guest.id),
      "host told"
    );

    const change = host.last("playerProfileChanged");

    assert.deepEqual(
      { name: change.name, color: change.color },
      { name: "Captain", color: 0xff66bb }
    );

    // the sender is told the result too
    await waitFor(() => guest.count("playerProfileChanged") === 1, "guest told");

    assert.equal(serverPlayer(host, guest).name, "Captain");
    assert.equal(serverPlayer(host, guest).color, 0xff66bb);
  });

  test("only what was sent changes", async () => {

    const host = track(await createRoom(app, { name: "Host", color: 0xff4444 }));

    host.room.send("setProfile", { name: "Boss" });

    await waitFor(() => serverPlayer(host, host).name === "Boss", "renamed");

    assert.equal(serverPlayer(host, host).color, 0xff4444);

    await sleep(200);

    host.room.send("setProfile", { color: 0x44ddee });

    await waitFor(() => serverPlayer(host, host).color === 0x44ddee, "recoloured");

    assert.equal(serverPlayer(host, host).name, "Boss");
  });

  test("a colour somebody else has is refused, the player keeps theirs", async () => {

    const host = track(await createRoom(app, { color: 0xff4444 }));
    const guest = track(await joinRoom(app, host, { color: 0x4488ff }));

    guest.room.send("setProfile", { color: 0xff4444 });

    await waitFor(() => guest.count("playerProfileChanged") === 1, "answer");

    assert.equal(guest.last("playerProfileChanged").color, 0x4488ff, "unchanged");
    assert.equal(serverPlayer(host, guest).color, 0x4488ff);
    assert.equal(serverPlayer(host, host).color, 0xff4444);
  });

  test("a name somebody has gets a number; nonsense is ignored", async () => {

    const host = track(await createRoom(app, { name: "Sam" }));
    const guest = track(await joinRoom(app, host, { name: "Guest" }));

    guest.room.send("setProfile", { name: "sam" });

    await waitFor(() => serverPlayer(host, guest).name === "sam 2", "numbered");

    await sleep(200);

    for (const junk of [null, 5, "x", [], { name: 5 }, { name: "😀" }, { color: "red" }, { color: 0x010203 }]) {
      guest.room.send("setProfile", junk);
      await sleep(170);
    }

    assert.equal(serverPlayer(host, guest).name, "sam 2", "garbage changed nothing");
    assert.ok((PALETTE as readonly number[]).includes(serverPlayer(host, guest).color));
  });

  test("it cannot be changed during a game", async () => {

    const host = track(await createRoom(app, { name: "Host", color: 0xff4444 }));
    const guest = track(await joinRoom(app, host, { name: "Guest", color: 0x4488ff }));

    await startGame(host, [guest]);

    guest.room.send("setProfile", { name: "Cheater", color: 0xff66bb });

    await sleep(300);

    assert.equal(serverPlayer(host, guest).name, "Guest");
    assert.equal(serverPlayer(host, guest).color, 0x4488ff);
    assert.equal(host.count("playerProfileChanged"), 0);
  });

  test("a quick colour-then-name is not dropped", async () => {

    const host = track(await createRoom(app, { name: "Host", color: 0xff4444 }));

    host.room.send("setProfile", { color: 0x44ddee });
    host.room.send("setProfile", { name: "Quick" });

    await waitFor(
      () => serverPlayer(host, host).name === "Quick" && serverPlayer(host, host).color === 0x44ddee,
      "both changes made"
    );
  });

  test("a flood of requests is harmless", async () => {

    const host = track(await createRoom(app, { name: "Host" }));

    for (let i = 0; i < 200; i++) {
      host.room.send("setProfile", { name: `Name${i}` });
    }

    await sleep(400);

    // a burst of five, plus what trickles in while we wait
    const allowed = host.count("playerProfileChanged");

    assert.ok(allowed >= 1 && allowed <= 8, `${allowed} changes went through`);
  });
});

describe("names and colours everywhere", () => {

  test("the game state carries them, so the game can show them", async () => {

    const host = track(await createRoom(app, { name: "Aditya", color: 0xaa66ff }));
    const guest = track(await joinRoom(app, host, { name: "Sam", color: 0xff8844 }));

    await startGame(host, [guest]);

    const names = host.state!.players.map((p) => [p.name, p.color]);

    assert.deepEqual(
      names.sort(),
      [["Aditya", 0xaa66ff], ["Sam", 0xff8844]].sort()
    );
  });

  test("a returning player is sent everyone's profile", async () => {

    const host = track(await createRoom(app, { name: "Aditya", color: 0xaa66ff }));
    const guest = track(await joinRoom(app, host, { name: "Sam", color: 0xff8844 }));

    guest.drop();

    await waitFor(() => guest.reconnects >= 1, "guest reconnects", 8000);

    const resync = await waitFor(() => guest.last("resync"), "resync");

    assert.deepEqual(
      resync.players.map((p: any) => [p.name, p.color]).sort(),
      [["Aditya", 0xaa66ff], ["Sam", 0xff8844]].sort()
    );
  });

  test("profiles survive going back to the lobby after a win", async () => {

    const host = track(await createRoom(app, { name: "Aditya", color: 0xaa66ff }));
    const guest = track(await joinRoom(app, host, { name: "Sam", color: 0xff8844 }));

    await startGame(host, [guest]);

    serverRoom(host).finishGame();

    await waitFor(() => host.count("gameFinished") === 1, "win");

    guest.room.send("requestResync");

    const resync = await waitFor(() => guest.last("resync"), "resync");

    assert.deepEqual(
      resync.players.map((p: any) => p.name).sort(),
      ["Aditya", "Sam"]
    );

    // and they can still be changed there
    guest.room.send("setProfile", { name: "Sammy" });

    await waitFor(() => serverPlayer(host, guest).name === "Sammy", "renamed in the lobby again");
  });
});
