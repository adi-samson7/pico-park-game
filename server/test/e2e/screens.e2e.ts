// In a real browser: the COPY button for the room code, and the "LEVEL N" /
// "LEVEL CLEAR" screens that hold everyone still between levels.
//
//   npm run build   (in client/)   then   npm run test:e2e   (in server/)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { matchMaker } from "colyseus";

import type { App } from "../../src/app.js";

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

describe("room code copy button and level screens (real browser)", { skip: skipReason }, () => {

  let app: App;

  let b: Browser;

  let bot: Bot | null = null;

  let roomId = "";

  let code = "";

  let rect = { x: 0, y: 0, w: 800 };

  const menu = "window.__pico.scene.getScene('MenuScene')";
  const lobby = "window.__pico.scene.getScene('LobbyScene')";
  const game = "window.__pico.scene.getScene('GameScene')";

  const until = (fn: () => Promise<any>, what: string, ms = 8000) =>
    waitFor(fn, what, ms, 30);

  const click = (gx: number, gy: number) =>
    b.click(rect.x + (gx * rect.w) / 800, rect.y + (gy * rect.w) / 800);

  const room = () => matchMaker.getLocalRoomById(roomId) as any;

  before(async () => {

    // Long enough to observe, short enough to keep the test quick.
    process.env.LEVEL_CLEAR_SECONDS = "2.5";
    process.env.LEVEL_INTRO_SECONDS = "2.5";

    app = await startApp({ staticDir: clientDist });

    b = await Browser.launch(chrome!);

    await b.send("Browser.grantPermissions", {
      origin: `http://127.0.0.1:${app.port}`,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"]
    });

    await b.goto(`http://127.0.0.1:${app.port}/?debug`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    rect = await b.eval(
      "(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()"
    );

    await sleep(700);
  });

  after(async () => {

    delete process.env.LEVEL_CLEAR_SECONDS;
    delete process.env.LEVEL_INTRO_SECONDS;

    await bot?.leave();

    await b?.close();

    await app?.close();
  });

  // ==========================================
  // COPY ROOM CODE
  // ==========================================

  const copyButton = (prop: string) => b.eval<any>(`${lobby}.copyButton.${prop}`);

  /** Clicks the middle of a game object (wherever the layout put it). */
  const clickObject = async (expression: string) => {

    const c = await b.eval<{ x: number; y: number }>(
      `(() => { const r = ${expression}.getBounds(); return { x: r.centerX, y: r.centerY }; })()`
    );

    await click(c.x, c.y);
  };

  test("the COPY button appears next to the room code once the code is known", async () => {

    assert.equal(await b.eval(`!!${menu}.sys.isActive()`), true);

    await clickObject(`${menu}.createButton`);

    await until(() => b.eval(`!!${lobby}.roomCode`), "room code");

    code = await b.eval<string>(`${lobby}.roomCode`);

    roomId = await b.eval<string>(`${lobby}.room.roomId`);

    assert.match(code, /^[A-Z0-9]{6}$/);

    assert.equal(await copyButton("visible"), true);
    assert.equal(await copyButton("text"), "COPY");

    // beside the code, not on top of it
    const codeRight = await b.eval<number>(`${lobby}.roomCodeText.getBounds().right`);

    assert.ok((await copyButton("x")) > codeRight, "to the right of the code");
  });

  test("clicking COPY puts the code on the clipboard and confirms it", async () => {

    // something else on the clipboard first
    await b.eval("navigator.clipboard.writeText('not the code')");

    await clickObject(`${lobby}.copyButton`);

    await until(async () => (await copyButton("text")) === "COPIED!", "confirmation");

    assert.equal(await b.eval("navigator.clipboard.readText()"), code, "the clipboard holds the room code");

    // back to normal after a moment
    await until(async () => (await copyButton("text")) === "COPY", "button resets", 4000);
  });

  test("clicking the code itself copies it too", async () => {

    await b.eval("navigator.clipboard.writeText('not the code')");

    await clickObject(`${lobby}.roomCodeText`);

    await until(async () => (await copyButton("text")) === "COPIED!", "confirmation");

    assert.equal(await b.eval("navigator.clipboard.readText()"), code);

    await until(async () => (await copyButton("text")) === "COPY", "button resets", 4000);
  });

  test("on a page without the clipboard API (plain http) it falls back to selecting the text", async () => {

    // No navigator.clipboard, and a spy on the old-style copy command.
    await b.eval(`(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      window.__selected = null;
      document.execCommand = (command) => {
        window.__selected = { command, text: document.activeElement && document.activeElement.value };
        return true;
      };
    })()`);

    await clickObject(`${lobby}.copyButton`);

    await until(async () => (await copyButton("text")) === "COPIED!", "confirmation");

    assert.deepEqual(
      await b.eval("window.__selected"),
      { command: "copy", text: code },
      "the code was selected in a hidden text box and copied"
    );

    assert.equal(
      await b.eval("document.querySelectorAll('textarea').length"),
      0,
      "the hidden box is gone again"
    );
  });

  test("when nothing can be copied it says so and shows the code", async () => {

    await b.eval(`document.execCommand = () => false`);

    await until(async () => (await copyButton("text")) === "COPY", "button resets", 4000);

    await clickObject(`${lobby}.copyButton`);

    await until(async () => (await copyButton("text")) === "PRESS CTRL+C", "failure message");

    assert.match(await b.eval<string>(`${lobby}.errorText.text`), new RegExp(code));
  });

  // ==========================================
  // LEVEL SCREENS
  // ==========================================
  //
  // How these tests watch: a recorder inside the page writes down, for EVERY
  // frame, the phase, the player's position, whether a key is down and the
  // banner's small text. The assertions then look at all those frames at once.
  // That does not depend on how quickly this test process manages to send
  // commands to the browser (a slow machine must not turn "frozen for 2.5 s"
  // into a race).

  const sprite = () =>
    b.eval<{ x: number; y: number }>(`(() => { const p = ${game}.localPlayer; return { x: p.x, y: p.y }; })()`);

  const banner = () =>
    b.eval<{ visible: boolean; title: string; sub: string; phase: string }>(`(() => {
      const s = ${game};
      return { visible: s.bannerVisible, title: s.bannerTitle.text, sub: s.bannerSub.text, phase: s.phase };
    })()`);

  /** Presses a key for a while. */
  const hold = async (key: string, ms: number) => {
    await b.key(key, key, true);
    await sleep(ms);
    await b.key(key, key, false);
  };

  interface Frame {
    t: number;
    phase: string;
    level: number;
    x: number;
    y: number;
    down: number;
    sub: string;
  }

  const startRecorder = () =>
    b.eval(`(() => {
      const down = (window.__down = new Set());
      window.addEventListener('keydown', (e) => down.add(e.code));
      window.addEventListener('keyup', (e) => down.delete(e.code));
      const rec = (window.__rec = []);
      const frame = (t) => {
        const s = ${game};
        const p = s && s.localPlayer;
        if (p && s.sys.isActive()) {
          rec.push({ t, phase: s.phase, level: s.shownLevel, x: p.x, y: p.y, down: down.size, sub: s.bannerSub ? s.bannerSub.text : '' });
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    })()`);

  const frames = () => b.eval<Frame[]>("window.__rec");

  /** What the recorded frames show while a screen (LEVEL N / LEVEL CLEAR) was
   *  up. The first 400 ms of each screen are skipped: the sprite is still
   *  settling into the new picture. */
  function inspect(recorded: Frame[], from = 0) {

    const result = {
      screens: 0,
      moved: [] as string[],
      keyed: { intro: 0, clear: 0 } as Record<string, number>,
      wiped: 0
    };

    let previous: Frame | null = null;
    let started = 0;
    let timeShown = false;

    for (const f of recorded.slice(from)) {

      if (f.phase === "playing") {
        previous = null;
        continue;
      }

      // A new screen starts when the phase changes (the level number changes
      // a moment earlier, while LEVEL CLEAR is still up).
      if (!previous || previous.phase !== f.phase) {
        started = f.t;
        timeShown = false;
        result.screens++;
      }

      if (f.phase === "clear") {

        if (/^Time/.test(f.sub)) {
          timeShown = true;
        } else if (timeShown) {
          result.wiped++;
        }
      }

      if (f.t - started >= 400) {

        if (f.down > 0) {
          result.keyed[f.phase]++;
        }

        if (previous && previous.t - started >= 400 && (f.x !== previous.x || f.y !== previous.y)) {
          result.moved.push(`${f.phase} level ${f.level} after ${Math.round(f.t - started)} ms: (${f.x}, ${f.y})`);
        }
      }

      previous = f;
    }

    return result;
  }

  let mark = 0;

  test("the game starts with a LEVEL 1 screen", async () => {

    bot = new Bot(await clientFor(app).joinById(roomId));

    bot.startInput(16);

    await until(() => b.eval(`${lobby}.players.size === 2`), "both in the lobby");

    bot.room.send("toggleReady");

    await b.eval(`${lobby}.room.send('toggleReady')`);

    await until(async () => room().areAllPlayersReady(), "everyone ready");

    await b.eval(`${lobby}.room.send('startGame')`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "game scene", 8000);

    await startRecorder();

    await until(async () => (await banner()).visible, "the LEVEL 1 banner", 3000);

    const shown = await banner();

    assert.equal(shown.title, "LEVEL 1");
    assert.equal(shown.phase, "intro");

    // Hold every key for a while: the checks come once the screen is over.
    await b.key("Space", " ", true);
    await hold("ArrowLeft", 700);
    await b.key("Space", " ", false);
  });

  test("the controls did nothing during it, then the banner goes and the player can move", async () => {

    await until(async () => (await banner()).phase === "playing", "the level starts", 6000);

    const seen = inspect(await frames(), mark);

    assert.deepEqual(seen.moved, [], "not a single frame of movement while the screen was up");
    assert.ok(seen.keyed.intro >= 3, `keys were down during ${seen.keyed.intro} frames of the screen`);

    await until(async () => !(await banner()).visible, "the banner is gone", 2000);

    // the player drops in from the spawn height and lands
    await until(
      () => b.eval(`(() => { const s = ${game}; const f = s.playerFx.get(s.room.sessionId); return !!f && f.grounded; })()`),
      "landed",
      6000
    );

    const before = await sprite();

    await hold("ArrowLeft", 400);

    assert.ok((await sprite()).x < before.x - 30, "walks");

    mark = (await frames()).length;
  });

  test("clearing the level shows LEVEL CLEAR with the time", async () => {

    const id = await b.eval<string>(`${game}.room.sessionId`);

    const r = room();

    const place = (who: string, x: number, y: number) => {
      const p = r.players.get(who);
      p.x = x; p.y = y; p.velocityX = 0; p.velocityY = 0; p.standingOn = null;
    };

    await sleep(100);

    for (const crystal of r.crystals.values()) {

      if (!crystal.collected) {

        place(id, crystal.x, crystal.y);

        await waitFor(() => r.crystals.get(crystal.id).collected, `crystal ${crystal.id}`, 4000, 20);
      }
    }

    await waitFor(() => r.doorOpen, "door open", 4000, 20);

    place(id, r.exit.x - 30, r.exit.y);
    place(bot!.id, r.exit.x + 30, r.exit.y);

    await until(async () => (await banner()).phase === "clear", "LEVEL CLEAR", 4000);

    await until(async () => (await banner()).visible, "banner visible");

    const cleared = await banner();

    assert.equal(cleared.title, "LEVEL CLEAR");
    assert.match(cleared.sub, /^Time \d+\.\d s$/, "shows how long the level took");

    // Hold every key while it is up.
    await b.key("Space", " ", true);
    await hold("ArrowRight", 700);
    await b.key("Space", " ", false);
  });

  test("then LEVEL 2 is shown, and only then does play start", async () => {

    await until(async () => (await banner()).title === "LEVEL 2", "the LEVEL 2 banner", 6000);

    assert.equal((await banner()).phase, "intro");
    assert.equal(await b.eval(`${game}.shownLevel`), 2);

    await hold("ArrowLeft", 700);

    await until(async () => (await banner()).phase === "playing", "level 2 starts", 6000);

    // Everything the recorder saw during LEVEL CLEAR and LEVEL 2:
    const seen = inspect(await frames(), mark);

    assert.equal(seen.screens, 2, "the two screens were recorded: LEVEL CLEAR, then LEVEL 2");
    assert.deepEqual(seen.moved, [], "no movement on either screen, whatever keys were down");
    assert.ok(seen.keyed.clear >= 3, `keys were down during ${seen.keyed.clear} frames of LEVEL CLEAR`);
    assert.ok(seen.keyed.intro >= 3, `keys were down during ${seen.keyed.intro} frames of LEVEL 2`);
    assert.equal(seen.wiped, 0, "the time on LEVEL CLEAR was never wiped by the next state");

    await until(async () => !(await banner()).visible, "banner gone", 2000);

    // movement is back
    await until(
      () => b.eval(`(() => { const s = ${game}; const f = s.playerFx.get(s.room.sessionId); return !!f && f.grounded; })()`),
      "landed",
      6000
    );

    const start = await sprite();

    await hold("ArrowLeft", 400);

    assert.ok((await sprite()).x < start.x - 30, "walks again");

    assert.deepEqual(
      b.logs.filter((l) => l.type === "exception"),
      [],
      "no uncaught exceptions"
    );
  });

  test("reloading the page during LEVEL CLEAR comes back to the right screen", async () => {

    const id = await b.eval<string>(`${game}.room.sessionId`);

    const r = room();

    const place = (who: string, x: number, y: number) => {
      const p = r.players.get(who);
      p.x = x; p.y = y; p.velocityX = 0; p.velocityY = 0; p.standingOn = null;
    };

    await sleep(100);

    for (const crystal of r.crystals.values()) {

      if (!crystal.collected) {

        place(id, crystal.x, crystal.y);

        await waitFor(() => r.crystals.get(crystal.id).collected, `crystal ${crystal.id}`, 4000, 20);
      }
    }

    await waitFor(() => r.doorOpen, "door open", 4000, 20);

    place(id, r.exit.x - 30, r.exit.y);
    place(bot!.id, r.exit.x + 30, r.exit.y);

    await waitFor(() => r.phase === "clear", "clear phase", 4000, 20);

    await b.goto(`http://127.0.0.1:${app.port}/?debug`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "back in the game", 10000);

    // Either still on the clear screen, or already on the next level's
    // screen: never "playing" with a banner stuck, never moving.
    const shown = await banner();

    assert.ok(
      shown.phase === "clear" || shown.phase === "intro" || shown.phase === "playing",
      JSON.stringify(shown)
    );

    await until(async () => (await banner()).phase === "playing", "play resumes after the screens", 8000);

    assert.equal((await banner()).visible, false, "no banner left over");
  });

  // ==========================================
  // PLAY AGAIN FROM THE SAME ROOM
  // ==========================================

  test("after the last level ENTER goes back to the lobby of the same room", async () => {

    const sessionBefore = await b.eval<string>(`${game}.room.sessionId`);

    // The last level has just been cleared.
    room().finishGame();

    await until(() => b.eval(`${game}.gameFinished`), "win screen");

    assert.match(await b.eval<string>(`${game}.messageText.text`), /YOU WIN[\s\S]*lobby/);

    await b.tap("Enter", "Enter");

    await until(() => b.eval(`${lobby}.sys.isActive() && ${lobby}.players.size === 2`), "back in the lobby");

    assert.equal(await b.eval(`${lobby}.room.roomId`), roomId, "the same room");
    assert.equal(await b.eval(`${lobby}.room.sessionId`), sessionBefore, "the same seat");
    assert.equal(await b.eval(`${lobby}.roomCode`), code, "the same room code");

    assert.match(await b.eval<string>(`${lobby}.statusText.text`), /Good game/);

    // nobody is ready, and the host can see the START button
    await until(() => b.eval(`${lobby}.players.get(${lobby}.room.sessionId).ready === false`), "unready");

    assert.equal(await b.eval(`${lobby}.readyButton.text`), "READY");

    // Only the host has START. (The page was reloaded earlier in this file,
    // which handed the host role to the bot: whoever it is stays host.)
    const hostId = await b.eval<string>(`${lobby}.hostId`);

    assert.equal(hostId, room().hostId, "the host is unchanged by the win");

    assert.equal(
      await b.eval(`${lobby}.startButton.visible`),
      hostId === sessionBefore,
      "START is shown to the host only"
    );
  });

  test("the lobby then starts a new game: ready up, START, and LEVEL 1 again", async () => {

    await clickObject(`${lobby}.readyButton`);

    bot!.room.send("toggleReady");

    await until(async () => room().areAllPlayersReady(), "everyone ready");

    const pageIsHost = (await b.eval<string>(`${lobby}.hostId`)) === (await b.eval<string>(`${lobby}.room.sessionId`));

    if (pageIsHost) {

      await until(async () => (await b.eval<string>(`${lobby}.startButton.text`)) === "START GAME", "START enabled");

      await clickObject(`${lobby}.startButton`);

    } else {

      // The bot is the host.
      bot!.room.send("startGame");
    }

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "a new game", 8000);

    await until(async () => (await banner()).visible, "the LEVEL 1 banner");

    assert.equal((await banner()).title, "LEVEL 1");

    assert.equal(await b.eval(`${game}.room.roomId`), roomId, "still the same room");

    await until(async () => (await banner()).phase === "playing", "playing", 6000);

    assert.deepEqual(
      b.logs.filter((l) => l.type === "exception"),
      [],
      "no uncaught exceptions"
    );
  });
});
