// Real-browser end-to-end test: headless Chrome plays the PRODUCTION build
// (served by the real server) against a second, scripted player.
//
//   npm run build   (in client/)   then   npm run test:e2e   (in server/)
//
// Needs Chrome/Chromium (CHROME_PATH, or a standard install). Skips with a
// reason when it can't run; set E2E_REQUIRE=1 to fail instead (CI does).
// Set E2E_SCREENSHOTS=<dir> to keep screenshots of each stage.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { App } from "../../src/app.js";

import { matchMaker } from "colyseus";

import { Bot, clientFor, startApp, waitFor } from "../helpers.js";

import { Browser, findChrome, sleep } from "./browser.js";

// ==========================================
// CAN WE RUN?
// ==========================================

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

// ==========================================
// TESTS
// ==========================================

describe("browser end-to-end (production build)", { skip: skipReason }, () => {

  let app: App;

  let b: Browser;

  let bot: Bot | null = null;

  let rect = { x: 0, y: 0, w: 800 };

  const shotDir = process.env.E2E_SCREENSHOTS;

  const shot = async (name: string) => {

    if (shotDir) {

      fs.mkdirSync(shotDir, { recursive: true });

      await b.screenshot(path.join(shotDir, `${name}.png`));
    }
  };

  // ---- helpers that talk to the page ----

  const scene = (key: string) => `window.__pico.scene.getScene('${key}')`;

  const click = (gx: number, gy: number) =>
    b.click(rect.x + (gx * rect.w) / 800, rect.y + (gy * rect.w) / 800);

  /** Clicks the middle of a game object, wherever the layout put it. */
  const clickObject = async (expression: string) => {

    const c = await b.eval<{ x: number; y: number }>(
      `(() => { const r = ${expression}.getBounds(); return { x: r.centerX, y: r.centerY }; })()`
    );

    await click(c.x, c.y);
  };

  const sfx = () => b.eval<string[]>("window.__sfx.slice()");

  const clearSfx = () => b.eval("window.__sfx.length = 0");

  const g = scene("GameScene");

  const fx = () =>
    b.eval<any>(`(() => {
      const s = ${g}; const f = s.playerFx.get(s.room.sessionId);
      return f && { sqX: f.sqX, sqY: f.sqY, facing: f.facing, grounded: f.grounded, tx: f.tx, ty: f.ty };
    })()`);

  const sprite = () =>
    b.eval<any>(`(() => {
      const s = ${g}.localPlayer;
      return { x: s.x, y: s.y, ang: s.angle, flip: s.flipX, ox: s.originX, oy: s.originY };
    })()`);

  const until = (fn: () => Promise<any>, what: string, ms = 5000) =>
    waitFor(fn, what, ms, 40);

  const emit = (type: string, payload: object = {}) =>
    b.eval(`${g}.room.dispatchMessage(${JSON.stringify(type)}, ${JSON.stringify(payload)})`);

  const emitters = () =>
    b.eval<number>(`${g}.children.list.filter(c => c.type === 'ParticleEmitter').length`);

  before(async () => {

    app = await startApp({ staticDir: clientDist });

    b = await Browser.launch(chrome!);

    await b.goto(`http://127.0.0.1:${app.port}/?debug`);

    await sleep(500);

    rect = await b.eval(
      "(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()"
    );

    // Record every sound the game asks for.
    await b.eval(`(() => {
      window.__sfx = [];
      const a = window.__audio;
      const original = a.sfx.bind(a);
      a.sfx = (name, options) => { window.__sfx.push(name); return original(name, options); };
    })()`);
  });

  after(async () => {

    await bot?.leave();

    await b?.close();

    await app?.close();
  });

  // ==========================================
  // MENU
  // ==========================================

  test("the production build serves and starts the game", async () => {

    assert.equal(await b.eval("document.title"), "PICO CO-OP");
    assert.ok(await b.eval(`${scene("MenuScene")}.sys.isActive()`));
  });

  test("the menu is animated and audio waits for a first gesture", async () => {

    assert.equal(await b.eval("window.__audio.running"), false, "autoplay is locked until the user acts");

    // The four mascots stand on the floor and hop every couple of seconds
    // (the backdrop itself is one picture).
    const pictures = await b.eval<number>(`${scene("MenuScene")}.children.list.filter((c) => c.type === 'Image').length`);

    assert.ok(pictures >= 5, `backdrop and four mascots (${pictures} pictures)`);

    // Sixteen translucent blocks drift upwards, turning as they go
    // (two animations each), plus the title dropping in.
    const tweens = await b.eval<number>(`${scene("MenuScene")}.tweens.getTweens().length`);

    assert.ok(tweens >= 20, `drifting blocks and the title animate (${tweens} tweens)`);

    await until(
      async () => (await b.eval<number>(`${scene("MenuScene")}.tweens.getTweens().length`)) >= 1,
      "something animates (the mascots start hopping)",
      6000
    );

    await shot("01-menu");
  });

  // ==========================================
  // LOBBY
  // ==========================================

  test("Create Room unlocks audio and opens the lobby with a room code", async () => {

    await clickObject(`${scene("MenuScene")}.createButton`);

    await until(() => b.eval("window.__audio.running"), "audio unlocked by the first click");
    await until(() => b.eval(`${scene("LobbyScene")}.sys.isActive()`), "lobby");
    await until(() => b.eval(`!!${scene("LobbyScene")}.roomCode`), "room code");

    assert.ok((await sfx()).includes("click"));
  });

  test("a second player joins and readies up, with matching sounds", async () => {

    const code = await b.eval<string>(`${scene("LobbyScene")}.roomCode`);

    const { roomId } = await (await fetch(`http://127.0.0.1:${app.port}/room/${code}`)).json();

    bot = new Bot(await clientFor(app).joinById(roomId));

    bot.startInput(50);

    await until(async () => (await sfx()).includes("join"), "join sound");

    bot.room.send("toggleReady");

    await until(async () => (await sfx()).includes("ready"), "ready sound");

    await shot("02-lobby");
  });

  test("clicking READY then START GAME starts the game", async () => {

    await clickObject(`${scene("LobbyScene")}.readyButton`);

    await until(
      () => b.eval(`${scene("LobbyScene")}.players.get(${scene("LobbyScene")}.room.sessionId)?.ready === true`),
      "local player ready"
    );

    await sleep(300);

    await clickObject(`${scene("LobbyScene")}.startButton`);

    await until(() => b.eval(`${g}.sys.isActive()`), "game scene", 8000);

    assert.ok((await sfx()).includes("start"), "start fanfare");
  });

  // ==========================================
  // GAME
  // ==========================================

  test("players drop in with landing and crystal sounds", async () => {

    await sleep(1800);

    const played = await sfx();

    assert.ok(played.includes("land"));
    assert.ok(played.includes("crystal"), "spawn platform has crystals within reach");
    assert.equal(await b.eval(`${g}.playerFx.size`), 2, "me and the other player");

    const s = await sprite();

    assert.equal(s.ox, 0.5);
    assert.equal(s.oy, 1, "sprites are anchored at the feet");

    assert.ok(await b.eval("window.__audio.activeMusic === 'game'"), "game music plays");

    await shot("03-game");
  });

  test("jumping plays a sound, stretches the player and produces real audio", async () => {

    await clearSfx();

    await b.tap("Space", " ");

    let stretch = 0;

    for (let i = 0; i < 25; i++) {

      stretch = Math.max(stretch, (await fx()).sqY);

      await sleep(12);
    }

    assert.ok((await sfx()).includes("jump"));
    assert.ok(stretch > 1.1, `stretches vertically (max sqY ${stretch.toFixed(2)})`);

    // does sound actually reach the output?
    await clearSfx();

    await b.tap("Space", " ", 30);

    let peak = 0;

    for (let i = 0; i < 20; i++) {

      peak = Math.max(peak, await b.eval<number>("window.__audio.peak()"));

      await sleep(10);
    }

    assert.ok(peak > 0.01, `analyser peak ${peak}`);

    await sleep(300);

    assert.ok((await sfx()).some((n) => n === "doubleJump" || n === "jump"));

    await shot("04-jump");
  });

  test("landing plays a sound and squashes the player", async () => {

    await sleep(900);

    await clearSfx();

    await b.tap("Space", " ");

    let squash = 2;

    for (let i = 0; i < 80; i++) {

      squash = Math.min(squash, (await fx()).sqY);

      await sleep(15);
    }

    assert.ok((await sfx()).includes("land"));
    assert.ok(squash < 0.95, `squashes on landing (min sqY ${squash.toFixed(2)})`);
  });

  test("walking off the ledge onto the spikes kills, with sound, and respawns safely", async () => {

    // The double jump above lands on the platform over the spawn ledge:
    // walk off its left edge back down onto the start ledge.
    await b.key("ArrowLeft", "ArrowLeft", true);

    await until(async () => (await fx()).tx < 140, "left of the upper platform", 4000);

    await b.key("ArrowLeft", "ArrowLeft", false);

    await until(
      async () => {
        const f = await fx();
        return f.grounded && Math.abs(f.ty - 440) < 2;
      },
      "back on the start ledge"
    );

    await sleep(300);

    await clearSfx();

    await b.key("ArrowRight", "ArrowRight", true);

    await until(async () => (await fx()).tx >= 214, "at the ledge edge", 4000);

    await b.key("ArrowRight", "ArrowRight", false);

    await until(async () => (await sfx()).includes("spikes"), "spike death sound");

    await sleep(150);

    await shot("05-death");

    await until(async () => (await sfx()).includes("respawn"), "respawn chime");

    await sleep(900);

    const f = await fx();

    assert.equal(f.tx, 180, "back at the spawn point");
    assert.ok(f.grounded);
  });

  test("walking faces the direction of travel and tilts the sprite", async () => {

    await sleep(400);

    await b.key("ArrowRight", "ArrowRight", true);

    await sleep(250);

    let tilt = 0;

    let flip: boolean | null = null;

    for (let i = 0; i < 12; i++) {

      const s = await sprite();

      tilt = Math.max(tilt, Math.abs(s.ang));

      flip = s.flip;

      await sleep(20);
    }

    await shot("06-walk");

    await b.key("ArrowRight", "ArrowRight", false);

    assert.equal(flip, false, "facing right");
    assert.ok(tilt > 0.5, `walk cycle tilts (${tilt.toFixed(1)}deg)`);

    await sleep(700);

    await b.key("ArrowLeft", "ArrowLeft", true);

    await sleep(200);

    const left = await sprite();

    await b.key("ArrowLeft", "ArrowLeft", false);

    assert.equal(left.flip, true, "faces left");
  });

  test("M mutes and unmutes, and the choice persists", async () => {

    await b.tap("KeyM", "m");

    assert.equal(await b.eval("window.__audio.isMuted"), true);
    assert.equal(await b.eval("localStorage.getItem('pico.muted.v2')"), "1");

    await b.tap("KeyM", "m");

    assert.equal(await b.eval("window.__audio.isMuted"), false);
    assert.equal(await b.eval("localStorage.getItem('pico.muted.v2')"), "0");
  });

  // ==========================================
  // SERVER MESSAGES -> CLIENT EFFECTS
  // ==========================================
  //
  // The real server messages are fed into the real client handlers.

  test("crystals bob (idle animation)", async () => {

    const before = await b.eval<number[]>(`[...${g}.crystalSprites.values()].map(c => c.y)`);

    await sleep(500);

    const after = await b.eval<number[]>(`[...${g}.crystalSprites.values()].map(c => c.y)`);

    const moved = after.filter((y, i) => Math.abs(y - before[i]) > 0.3).length;

    assert.ok(moved >= 5, `${moved}/${before.length} crystals moved`);
  });

  test("the door opens with a fanfare, turns green and pulses", async () => {

    await clearSfx();

    await emit("doorOpened");

    assert.ok((await sfx()).includes("doorOpen"));
    assert.equal(await b.eval(`${g}.doorLabel.text`), "EXIT");

    // Right away: the message only stays up for 1.6 s, and the pulse check
    // below can take longer than that on a busy machine.
    assert.ok((await b.eval<string>(`${g}.messageText.text`)).includes("EXIT OPEN"));

    const alphas = new Set<string>();

    for (let i = 0; i < 4; i++) {

      alphas.add((await b.eval<number>(`${g}.doorRect.alpha`)).toFixed(2));

      await sleep(230);
    }

    assert.ok(alphas.size > 1, `pulsing: ${[...alphas].join(" ")}`);

    await shot("07-door-open");
  });

  test("falling into a pit shows a message and plays the fall sound", async () => {

    await clearSfx();

    const me = await b.eval<string>(`${g}.room.sessionId`);

    await emit("playerRespawned", { id: me, x: 180, y: 300, cause: "fell" });

    assert.ok((await sfx()).includes("fall"));
    assert.equal(await b.eval(`${g}.messageText.text`), "YOU FELL!");

    await sleep(500);

    assert.ok((await sfx()).includes("respawn"));
  });

  test("completing a level plays a fanfare and fires confetti", async () => {

    await clearSfx();

    await emit("levelCompleted", { completedLevel: 1, nextLevel: 2 });

    assert.ok((await sfx()).includes("levelComplete"));

    await sleep(250);

    assert.ok((await emitters()) >= 1);

    await shot("08-level-complete");
  });

  test("winning plays the jingle, stops the music and keeps the win text up", async () => {

    await clearSfx();

    await emit("gameFinished", { result: "win" });

    assert.ok((await sfx()).includes("win"));
    assert.ok(await b.eval("window.__audio.wantedMusic === null && window.__audio.activeMusic === null"));

    const text = await b.eval<string>(`${g}.messageText.text`);

    assert.ok(text.includes("YOU WIN") && text.includes("ENTER"));

    // The level-complete message above fades out 1.2s after it appeared: it must
    // not wipe the win text.
    await sleep(1500);

    assert.ok((await b.eval<string>(`${g}.messageText.text`)).includes("YOU WIN"));
    assert.equal(await b.eval(`${g}.messageText.alpha`), 1);
    assert.ok((await emitters()) >= 1, "confetti is raining");

    await shot("09-win");
  });

  test("particle emitters are all cleaned up afterwards (no leak)", async () => {

    await sleep(11500);

    assert.equal(await emitters(), 0);
  });

  test("ENTER on the win screen goes back to the lobby of the same room and restarts the menu music", async () => {

    // The win above was a message injected into the page; make the server
    // finish the game for real, as it does when the last level is cleared
    // (it turns the room back into a lobby).
    const roomId = await b.eval<string>(`${g}.room.roomId`);

    (matchMaker.getLocalRoomById(roomId) as any).finishGame();

    await sleep(300);

    await b.tap("Enter", "Enter", 60);

    await until(() => b.eval(`${scene("LobbyScene")}.sys.isActive()`), "lobby");
    await until(() => b.eval("window.__audio.activeMusic === 'menu'"), "menu music");

    assert.equal(await b.eval(`${scene("LobbyScene")}.room.roomId`), roomId, "still in the same room");
    assert.equal(await b.eval(`${scene("MenuScene")}.sys.isActive()`), false, "not thrown out to the menu");
  });

  test("the whole session produced no console errors or exceptions", () => {

    const errors = b.logs.filter((l) => l.type === "exception" || l.type === "error");

    assert.deepEqual(errors, []);
  });
});
