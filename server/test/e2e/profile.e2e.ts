// In a real browser: the player's name and colour (set in the menu, shown in the
// lobby and in the game, changed in the lobby).
//
//   npm run build   (in client/)   then   npm run test:e2e   (in server/)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { matchMaker } from "colyseus";

import type { App } from "../../src/app.js";

import { PALETTE } from "../../src/profile.js";

import { Bot, clientFor, startApp, waitFor } from "../helpers.js";

import { Browser, findChrome, sleep } from "./browser.js";

const clientDist = path.resolve(import.meta.dirname, "../../../client/dist");

const chrome = findChrome();

const skipReason: string | false =
  !chrome
    ? "no Chrome/Chromium found (set CHROME_PATH)"
    : !fs.existsSync(path.join(clientDist, "index.html"))
      ? "the client is not built (run `npm run build` in client/)"
      : false;

if (skipReason && process.env.E2E_REQUIRE) {
  throw new Error(`E2E_REQUIRE is set but: ${skipReason}`);
}

describe("name and colour (real browser)", { skip: skipReason }, () => {

  let app: App;

  let b: Browser;

  let bot: Bot | null = null;

  let roomId = "";

  let rect = { x: 0, y: 0, w: 800 };

  const menu = "window.__pico.scene.getScene('MenuScene')";
  const lobby = "window.__pico.scene.getScene('LobbyScene')";
  const game = "window.__pico.scene.getScene('GameScene')";

  const until = (fn: () => Promise<any>, what: string, ms = 8000) =>
    waitFor(fn, what, ms, 30);

  const click = (gx: number, gy: number) =>
    b.click(rect.x + (gx * rect.w) / 800, rect.y + (gy * rect.w) / 800);

  const room = () => matchMaker.getLocalRoomById(roomId) as any;

  const stored = () =>
    b.eval<{ name: string; color: number | null } | null>(
      "JSON.parse(localStorage.getItem('pico.profile') || 'null')"
    );

  const swatchX = (i: number) => 400 + (i - 3.5) * 32;

  const SWATCH_Y = 556;

  const goToMenu = async () => {

    await b.goto(`http://127.0.0.1:${app.port}/?debug`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    rect = await b.eval(
      "(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()"
    );

    await sleep(600);
  };

  before(async () => {

    // Long enough to look at the LEVEL CLEAR banner.
    process.env.LEVEL_CLEAR_SECONDS = "3";
    process.env.LEVEL_INTRO_SECONDS = "0.3";

    app = await startApp({ staticDir: clientDist });

    b = await Browser.launch(chrome!);

    await goToMenu();

    // A clean slate for this origin.
    await b.eval("localStorage.clear(); sessionStorage.clear();");

    await goToMenu();
  });

  after(async () => {

    process.env.LEVEL_CLEAR_SECONDS = "0.05";
    process.env.LEVEL_INTRO_SECONDS = "0.05";

    await bot?.leave();

    await b?.close();

    await app?.close();
  });

  // ==========================================
  // THE MENU
  // ==========================================

  test("the menu has a name box and eight colours", async () => {

    assert.equal(await b.eval("document.querySelectorAll('input').length"), 1);
    assert.equal(await b.eval("document.querySelector('input').placeholder"), "Your name");
    assert.equal(await b.eval("document.querySelector('input').maxLength"), 12);

    assert.equal(
      await b.eval(`${menu}.children.list.filter((c) => c.getData && c.getData('color') !== undefined).length`),
      8
    );

    // the box sits over the canvas, inside it
    const placed = await b.eval<{ inside: boolean }>(`(() => {
      const i = document.querySelector('input').getBoundingClientRect();
      const c = document.querySelector('canvas').getBoundingClientRect();
      return { inside: i.left >= c.left && i.right <= c.right && i.top >= c.top && i.bottom <= c.bottom };
    })()`);

    assert.equal(placed.inside, true);
  });

  test("typing in the box does not reach the game (M would mute it)", async () => {

    await b.eval("document.querySelector('input').focus()");

    const muted = await b.eval<boolean>("window.__audio.isMuted");

    for (const [key, code, vk] of [["m", "KeyM", 77], ["a", "KeyA", 65]] as const) {

      await b.send("Input.dispatchKeyEvent", {
        type: "keyDown", key, code, text: key, windowsVirtualKeyCode: vk
      });

      await b.send("Input.dispatchKeyEvent", {
        type: "keyUp", key, code, windowsVirtualKeyCode: vk
      });
    }

    assert.equal(await b.eval("document.querySelector('input').value"), "ma", "the letters went into the box");
    assert.equal(await b.eval<boolean>("window.__audio.isMuted"), muted, "and did not toggle the sound");

    // clear it again
    await b.eval("(() => { const i = document.querySelector('input'); i.value = ''; i.dispatchEvent(new Event('input')); })()");
  });

  test("a name is cleaned when you leave the box, and remembered", async () => {

    await b.eval("document.querySelector('input').focus()");

    await b.send("Input.insertText", { text: "  Aditya   K  " });

    await b.eval("document.querySelector('input').blur()");

    assert.equal(await b.eval("document.querySelector('input').value"), "Aditya K");
    assert.equal((await stored())!.name, "Aditya K");

    // nonsense is stripped
    await b.eval("document.querySelector('input').focus()");
    await b.eval("document.querySelector('input').select()");
    await b.send("Input.insertText", { text: "Ada<>😀" });
    await b.eval("document.querySelector('input').blur()");

    assert.equal(await b.eval("document.querySelector('input').value"), "Ada");

    // back to the name used below
    await b.eval("document.querySelector('input').focus()");
    await b.eval("document.querySelector('input').select()");
    await b.send("Input.insertText", { text: "Aditya K" });
    await b.eval("document.querySelector('input').blur()");

    assert.equal((await stored())!.name, "Aditya K");
  });

  test("a colour can be picked and unpicked", async () => {

    assert.equal((await stored())!.color, null, "none chosen yet");

    await click(swatchX(5), SWATCH_Y);

    assert.equal((await stored())!.color, PALETTE[5]);

    const chosen = await b.eval<number[]>(
      `${menu}.children.list.filter((c) => c.getData && c.getData('color') !== undefined && c.scaleX > 1).map((c) => c.getData('color'))`
    );

    assert.deepEqual(chosen, [PALETTE[5]], "the picked colour is shown as selected");

    await click(swatchX(5), SWATCH_Y);

    assert.equal((await stored())!.color, null, "clicking it again lets the game choose");

    await click(swatchX(5), SWATCH_Y);

    assert.equal((await stored())!.color, PALETTE[5]);
  });

  test("they are still there after reloading the page", async () => {

    await goToMenu();

    assert.equal(await b.eval("document.querySelector('input').value"), "Aditya K");

    const chosen = await b.eval<number[]>(
      `${menu}.children.list.filter((c) => c.getData && c.getData('color') !== undefined && c.scaleX > 1).map((c) => c.getData('color'))`
    );

    assert.deepEqual(chosen, [PALETTE[5]]);
  });

  // ==========================================
  // THE LOBBY
  // ==========================================

  test("the lobby shows the chosen name and colour, and so does the server", async () => {

    await click(400, 280); // CREATE ROOM

    await until(() => b.eval(`!!${lobby}.roomCode`), "room code");

    roomId = await b.eval<string>(`${lobby}.room.roomId`);

    const me = await b.eval<string>(`${lobby}.room.sessionId`);

    assert.equal(room().players.get(me).name, "Aditya K");
    assert.equal(room().players.get(me).color, PALETTE[5]);

    const mine = await b.eval<{ name: string; color: number }>(
      `(() => { const p = ${lobby}.players.get(${lobby}.room.sessionId); return { name: p.name, color: p.color }; })()`
    );

    assert.deepEqual(mine, { name: "Aditya K", color: PALETTE[5] });
  });

  test("another player with the same name and colour gets a different one, and everyone sees it", async () => {

    bot = new Bot(await clientFor(app).joinById(roomId, { name: "aditya k", color: PALETTE[5] }));

    bot.startInput(16);

    await until(() => b.eval(`${lobby}.players.size === 2`), "both in the lobby");

    const theirs = await b.eval<{ name: string; color: number }>(
      `(() => { const p = ${lobby}.players.get(${JSON.stringify(bot.id)}); return { name: p.name, color: p.color }; })()`
    );

    assert.equal(theirs.name, "aditya k 2", "the name was numbered");
    assert.notEqual(theirs.color, PALETTE[5], "and the colour was not the same");

    // the roster on screen names them both
    const texts = await b.eval<string[]>(
      `${lobby}.children.list.filter((c) => c.type === 'Text').map((c) => c.text)`
    );

    assert.ok(texts.some((t) => t.includes("Aditya K") && t.includes("(you)")), "my row");
    assert.ok(texts.some((t) => t.includes("aditya k 2")), "their row");
  });

  test("clicking your own colour moves to the next free one", async () => {

    const me = await b.eval<string>(`${lobby}.room.sessionId`);

    const before = room().players.get(me).color;

    await click(138, 275); // my colour dot (first row)

    await until(async () => room().players.get(me).color !== before, "colour changed");

    const now = room().players.get(me).color;

    assert.ok((PALETTE as readonly number[]).includes(now));
    assert.notEqual(now, room().players.get(bot!.id).color, "never one that somebody has");

    // the page, the other player and the saved profile all agree
    await until(
      async () => (await b.eval<number>(`${lobby}.players.get(${JSON.stringify(me)}).color`)) === now,
      "the page shows the new colour"
    );

    await until(async () => bot!.last("playerProfileChanged")?.color === now, "the bot is told");

    await until(async () => (await stored())!.color === now, "remembered for next time");
  });

  test("clicking your own name asks for a new one", async () => {

    const me = await b.eval<string>(`${lobby}.room.sessionId`);

    await b.eval(`window.prompt = () => "Captain  <Jump>"`);

    await click(220, 275);

    await until(async () => room().players.get(me).name === "Captain Jump", "renamed (and cleaned)");

    await until(async () => bot!.last("playerProfileChanged")?.name === "Captain Jump", "the bot is told");

    await until(
      async () => (await b.eval<string>(`${lobby}.players.get(${JSON.stringify(me)}).name`)) === "Captain Jump",
      "the page shows the new name"
    );

    assert.equal((await stored())!.name, "Captain Jump", "remembered");

    // cancelling changes nothing
    await b.eval(`window.prompt = () => null`);

    await click(220, 275);

    await sleep(300);

    assert.equal(room().players.get(me).name, "Captain Jump");
  });

  // ==========================================
  // THE GAME
  // ==========================================

  test("in the game everybody's name is floating over them", async () => {

    bot!.room.send("toggleReady");

    await b.eval(`${lobby}.room.send('toggleReady')`);

    await until(async () => room().areAllPlayersReady(), "ready");

    await b.eval(`${lobby}.room.send('startGame')`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "game", 8000);

    await until(async () => room().phase === "playing", "playing");

    await sleep(600);

    const labels = await b.eval<Record<string, string>>(
      `Object.fromEntries([...${game}.nameLabels].map(([id, t]) => [id, t.text]))`
    );

    assert.deepEqual(
      Object.values(labels).sort(),
      ["Captain Jump", "aditya k 2"]
    );

    // each is above its own player
    const placement = await b.eval<{ above: boolean; visible: boolean }[]>(`[...${game}.nameLabels].map(([id, t]) => {
      const s = id === ${game}.room.sessionId ? ${game}.localPlayer : ${game}.remotePlayers.get(id);
      return { above: t.y < s.y - 55, visible: t.visible };
    })`);

    assert.ok(placement.every((p) => p.above && p.visible), JSON.stringify(placement));

    // and the sprites have the colours the players chose
    const me = await b.eval<string>(`${game}.room.sessionId`);

    assert.equal(
      await b.eval(`${game}.playerFx.get(${JSON.stringify(me)}).color`),
      room().players.get(me).color
    );
  });

  test("clearing a level shows how long it took", async () => {

    const me = await b.eval<string>(`${game}.room.sessionId`);

    const r = room();

    const place = (who: string, x: number, y: number) => {
      const p = r.players.get(who);
      p.x = x; p.y = y; p.velocityX = 0; p.velocityY = 0; p.standingOn = null;
    };

    await sleep(100);

    for (const crystal of r.crystals.values()) {

      if (!crystal.collected) {

        place(me, crystal.x, crystal.y);

        await waitFor(() => r.crystals.get(crystal.id).collected, `crystal ${crystal.id}`, 4000, 20);
      }
    }

    await waitFor(() => r.doorOpen, "door open", 4000, 20);

    place(me, r.exit.x - 30, r.exit.y);
    place(bot!.id, r.exit.x + 30, r.exit.y);

    await until(() => b.eval(`${game}.phase === 'clear' && ${game}.bannerVisible`), "LEVEL CLEAR");

    const sub = await b.eval<string>(`${game}.bannerSub.text`);

    assert.match(sub, /^Time \d+\.\d s$/);

    // The names are still floating over the players, greyed behind the banner.
    assert.deepEqual(
      Object.values(
        await b.eval<Record<string, string>>(
          `Object.fromEntries([...${game}.nameLabels].map(([id, t]) => [id, t.text]))`
        )
      ).sort(),
      ["Captain Jump", "aditya k 2"]
    );
  });

  test("the whole session had no errors", async () => {

    assert.deepEqual(
      b.logs.filter((l) => l.type === "exception"),
      [],
      "no uncaught exceptions"
    );
  });
});
