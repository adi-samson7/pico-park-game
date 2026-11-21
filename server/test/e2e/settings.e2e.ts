// The in-game settings menu and the keyboard, in a real browser.
//
//   - A / D / W move and jump whatever the browser says the key's number is
//     (Chrome reports 229 for letters while an input method is on: this was
//     the "WASD does not work in Chrome" bug). The arrows keep working.
//   - Esc and the cog open the menu; the player does not move while it is open
//   - sound on/off and the two volume sliders work and are remembered
//   - EXIT GAME asks first; STAY keeps playing, LEAVE goes to the main menu
//     and the room sees the player go
//
//   npm run build   (in client/)   then   npm run test:e2e   (in server/)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { App } from "../../src/app.js";

import { Bot, clientFor, serverRoom, startApp, waitFor } from "../helpers.js";

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

describe("settings menu and keys (real browser)", { skip: skipReason }, () => {

  let app: App;

  let b: Browser;

  let bot: Bot;

  const scene = (key: string) => `window.__pico.scene.getScene('${key}')`;

  const game = scene("GameScene");

  const until = (fn: () => Promise<any>, what: string, ms = 10000) =>
    waitFor(fn, what, ms, 40);

  const x = () => b.eval<number>(`${game}.localPlayer.x`);

  const grounded = () =>
    b.eval<boolean>(
      `(() => { const s = ${game}; const f = s.playerFx.get(s.room.sessionId); return !!f && f.grounded; })()`
    );

  const settingsOpen = () => b.eval<boolean>(`${game}.settings.isOpen`);

  // The canvas position of a game-space point.
  const toPage = (gx: number, gy: number) =>
    b.eval<{ x: number; y: number }>(
      `(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const k = c.width / 800; return { x: c.left + ${gx} * k, y: c.top + ${gy} * k }; })()`
    );

  // Click the visible settings button with this label.
  const clickButton = async (label: string) => {

    const centre = await b.eval<{ x: number; y: number } | null>(
      `(() => {
        const items = ${game}.settings.root.list;
        const found = items.find((i) => i.type === 'Container' && i.visible && i.text === ${JSON.stringify(label)});
        if (!found) return null;
        const r = found.getBounds();
        const c = document.querySelector('canvas').getBoundingClientRect();
        const k = c.width / 800;
        return { x: c.left + r.centerX * k, y: c.top + r.centerY * k };
      })()`
    );

    assert.ok(centre, `a visible button "${label}"`);

    await b.click(centre.x, centre.y);
  };

  // How far the player gets while a key is held (the largest move from where
  // it started, so a fall or respawn afterwards does not matter).
  const holdKey = async (
    down: object,
    up: object,
    ms = 450
  ): Promise<number> => {

    await until(grounded, "standing on something");

    await sleep(250);

    const before = await x();

    await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...down });

    let farthest = 0;

    for (let t = 0; t < ms; t += 30) {

      await sleep(30);

      farthest = Math.max(farthest, Math.abs((await x()) - before));
    }

    await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...up });

    await sleep(250);

    return farthest;
  };

  before(async () => {

    app = await startApp({ staticDir: clientDist });

    b = await Browser.launch(chrome!);

    await b.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false
    });

    await b.goto(`http://127.0.0.1:${app.port}/?debug`);

    await until(() => b.eval(`${scene("MenuScene")}.sys.isActive()`), "menu");

    await b.eval("localStorage.clear(); sessionStorage.clear();");

    await sleep(600);

    // create a room from the menu, join it with a bot, play
    await b.eval(`${scene("MenuScene")}.createButton.emit('pointerdown')`);

    await until(() => b.eval(`!!${scene("LobbyScene")}.roomCode`), "a room code");

    const roomId = await b.eval<string>(`${scene("LobbyScene")}.room.roomId`);

    bot = new Bot(await clientFor(app).joinById(roomId));

    bot.startInput(50);

    await until(() => b.eval(`${scene("LobbyScene")}.players.size === 2`), "two players");

    bot.room.send("toggleReady");

    await b.eval(`${scene("LobbyScene")}.room.send('toggleReady')`);

    await until(async () => serverRoom(bot).areAllPlayersReady(), "everyone ready");

    await b.eval(`${scene("LobbyScene")}.room.send('startGame')`);

    await until(
      () => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`),
      "the game"
    );

    await until(async () => serverRoom(bot).phase === "playing", "playing");
  });

  after(async () => {

    await bot?.leave().catch(() => {});

    await b?.close();

    await app?.close();
  });

  describe("the keys (the Chrome bug)", () => {

    const cases: Array<[string, object, object, number]> = [
      [
        "D, a normal keyboard",
        { key: "d", code: "KeyD", windowsVirtualKeyCode: 68, text: "d" },
        { key: "d", code: "KeyD", windowsVirtualKeyCode: 68 },
        15
      ],
      [
        "A, a normal keyboard",
        { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" },
        { key: "a", code: "KeyA", windowsVirtualKeyCode: 65 },
        15
      ],
      [
        "D while an input method is on (keyCode 229)",
        { key: "Process", code: "KeyD", windowsVirtualKeyCode: 229 },
        { key: "Process", code: "KeyD", windowsVirtualKeyCode: 229 },
        15
      ],
      [
        "A while an input method is on (keyCode 229)",
        { key: "Process", code: "KeyA", windowsVirtualKeyCode: 229 },
        { key: "Process", code: "KeyA", windowsVirtualKeyCode: 229 },
        15
      ],
      [
        "D with no key number at all",
        { key: "d", code: "KeyD" },
        { key: "d", code: "KeyD" },
        15
      ],
      [
        "a Hindi keyboard (a Devanagari letter on the D key)",
        { key: "द", code: "KeyD", windowsVirtualKeyCode: 68 },
        { key: "द", code: "KeyD", windowsVirtualKeyCode: 68 },
        15
      ],
      [
        "an AZERTY keyboard (the key labelled Q where A is)",
        { key: "q", code: "KeyA", windowsVirtualKeyCode: 81 },
        { key: "q", code: "KeyA", windowsVirtualKeyCode: 81 },
        15
      ],
      [
        "the arrow key (it always worked)",
        { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
        { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
        15
      ]
    ];

    for (const [name, down, up, minimum] of cases) {

      test(`moves: ${name}`, async () => {

        const far = await holdKey(down, up);

        assert.ok(far > minimum, `moved ${far.toFixed(0)} px`);
      });
    }

    test("a key that is not a game key does not move the player", async () => {

      const far = await holdKey(
        { key: "q", code: "KeyQ", windowsVirtualKeyCode: 81, text: "q" },
        { key: "q", code: "KeyQ", windowsVirtualKeyCode: 81 }
      );

      assert.ok(far < 5, `moved ${far.toFixed(0)} px`);
    });

    test("W jumps even with keyCode 229", async () => {

      await until(grounded, "standing");

      await sleep(250);

      const y0 = await b.eval<number>(`${game}.localPlayer.y`);

      await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Process", code: "KeyW", windowsVirtualKeyCode: 229 });

      let highest = 0;

      for (let i = 0; i < 12; i++) {

        await sleep(30);

        highest = Math.max(highest, y0 - (await b.eval<number>(`${game}.localPlayer.y`)));
      }

      await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Process", code: "KeyW", windowsVirtualKeyCode: 229 });

      assert.ok(highest > 20, `rose ${highest.toFixed(0)} px`);
    });

    test("the menu can name the last key it saw (to find out what a browser sends)", async () => {

      await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Process", code: "KeyD", windowsVirtualKeyCode: 229 });
      await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Process", code: "KeyD", windowsVirtualKeyCode: 229 });

      const last = await b.eval<string>("window.__controls.lastKey");

      assert.match(last, /KeyD/);
      assert.match(last, /229/);
    });
  });

  describe("opening and closing", () => {

    test("Esc opens it and Esc closes it", async () => {

      assert.equal(await settingsOpen(), false);

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      await b.tap("Escape", "Escape");

      await until(async () => !(await settingsOpen()), "closed");
    });

    test("so does the cog, and RESUME", async () => {

      const cog = await toPage(42, 82);

      await b.click(cog.x, cog.y);

      await until(settingsOpen, "open from the cog");

      await clickButton("RESUME");

      await until(async () => !(await settingsOpen()), "closed with RESUME");
    });

    test("the player does not move while it is open, and moves again after", async () => {

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      const still = await holdKey(
        { key: "d", code: "KeyD", windowsVirtualKeyCode: 68, text: "d" },
        { key: "d", code: "KeyD", windowsVirtualKeyCode: 68 }
      );

      assert.ok(still < 5, `moved ${still.toFixed(0)} px behind the menu`);

      await b.tap("Escape", "Escape");

      await until(async () => !(await settingsOpen()), "closed");

      const moving = await holdKey(
        { key: "d", code: "KeyD", windowsVirtualKeyCode: 68, text: "d" },
        { key: "d", code: "KeyD", windowsVirtualKeyCode: 68 }
      );

      assert.ok(moving > 15, `moved ${moving.toFixed(0)} px after`);
    });

    test("a key held when the menu opened is not stuck when it closes", async () => {

      await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68, text: "d" });

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 });

      await b.tap("Escape", "Escape");

      await until(async () => !(await settingsOpen()), "closed");

      await until(grounded, "standing");

      await sleep(300);

      const before = await x();

      await sleep(500);

      assert.ok(Math.abs((await x()) - before) < 5, "the player stands still");
    });
  });

  describe("sound", () => {

    test("the sound button and M agree", async () => {

      const muted = () => b.eval<boolean>("window.__audio.isMuted");

      assert.equal(await muted(), false);

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      // the button says what is on
      const label = () =>
        b.eval<string>(
          `${game}.settings.soundButton.text`
        );

      assert.equal(await label(), "ON");

      const sound = await b.eval<{ x: number; y: number }>(
        `(() => { const r = ${game}.settings.soundButton.getBounds(); const c = document.querySelector('canvas').getBoundingClientRect(); const k = c.width / 800; return { x: c.left + r.centerX * k, y: c.top + r.centerY * k }; })()`
      );

      await b.click(sound.x, sound.y);

      await until(muted, "muted by the button");

      await until(async () => (await label()) === "OFF", "the button says OFF");

      // M works while the menu is open
      await b.tap("KeyM", "m");

      await until(async () => !(await muted()), "on again with M");

      await until(async () => (await label()) === "ON", "the button says ON");

      await b.tap("Escape", "Escape");

      await until(async () => !(await settingsOpen()), "closed");
    });

    test("the sliders set the volumes and they are remembered", async () => {

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      // MUSIC at y 242, EFFECTS at y 292; the track runs x 318..538
      const musicAt = await toPage(318 + 220 * 0.25, 242);

      await b.click(musicAt.x, musicAt.y);

      const effectsAt = await toPage(318 + 220 * 0.6, 292);

      await b.click(effectsAt.x, effectsAt.y);

      await until(
        async () => Math.abs((await b.eval<number>("window.__audio.musicLevel")) - 0.25) < 0.03,
        "music 25%"
      );

      await until(
        async () => Math.abs((await b.eval<number>("window.__audio.sfxLevel")) - 0.6) < 0.03,
        "effects 60%"
      );

      const saved = JSON.parse(await b.eval<string>("localStorage.getItem('pico.volume.v1')"));

      assert.ok(Math.abs(saved.music - 0.25) < 0.03, `saved music ${saved.music}`);
      assert.ok(Math.abs(saved.sfx - 0.6) < 0.03, `saved effects ${saved.sfx}`);

      // the ends of the track are 0 and 100 %, and nothing goes past them
      const leftEnd = await toPage(318 - 12, 242);

      await b.click(leftEnd.x, leftEnd.y);

      await until(async () => (await b.eval<number>("window.__audio.musicLevel")) === 0, "0 at the left end");

      const rightEnd = await toPage(318 + 220 + 12, 242);

      await b.click(rightEnd.x, rightEnd.y);

      await until(async () => (await b.eval<number>("window.__audio.musicLevel")) === 1, "100 at the right end");

      await b.tap("Escape", "Escape");

      await until(async () => !(await settingsOpen()), "closed");
    });

    test("the volumes come back after a reload", async () => {

      await b.eval("window.__audio.setMusicLevel(0.4); window.__audio.setSfxLevel(0.7);");

      const levels = await b.eval<string>(
        `(async () => { const { AudioManager } = { AudioManager: window.__audio.constructor }; const fresh = new AudioManager(); return JSON.stringify([fresh.musicLevel, fresh.sfxLevel]); })()`
      );

      assert.deepEqual(JSON.parse(levels), [0.4, 0.7]);
    });
  });

  describe("leaving", () => {

    test("EXIT GAME asks first, and STAY goes back to the settings", async () => {

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      await clickButton("EXIT GAME");

      // the question is shown, the sliders are not
      await until(
        () =>
          b.eval(
            `${game}.settings.root.list.some((i) => i.type === 'Container' && i.visible && i.text === 'LEAVE')`
          ),
        "the question"
      );

      assert.equal(await b.eval(`${game}.sys.isActive()`), true, "still in the game");

      // Esc backs out of the question (does not close the menu)
      await b.tap("Escape", "Escape");

      await until(
        () =>
          b.eval(
            `${game}.settings.root.list.some((i) => i.type === 'Container' && i.visible && i.text === 'EXIT GAME')`
          ),
        "back at the settings"
      );

      assert.equal(await settingsOpen(), true);

      await clickButton("EXIT GAME");

      await clickButton("STAY");

      await until(
        () =>
          b.eval(
            `${game}.settings.root.list.some((i) => i.type === 'Container' && i.visible && i.text === 'EXIT GAME')`
          ),
        "back at the settings with STAY"
      );

      assert.equal(await b.eval(`${game}.sys.isActive()`), true);

      await b.tap("Escape", "Escape");

      await until(async () => !(await settingsOpen()), "closed");
    });

    test("LEAVE goes to the main menu, and the room sees the player go", async () => {

      const before = serverRoom(bot).clients.length;

      assert.equal(before, 2);

      await b.tap("Escape", "Escape");

      await until(settingsOpen, "open");

      await clickButton("EXIT GAME");

      await clickButton("LEAVE");

      await until(() => b.eval(`${scene("MenuScene")}.sys.isActive()`), "the main menu");

      await until(async () => serverRoom(bot).clients.length === 1, "the room has one player left");

      assert.equal(await b.eval(`${game}.sys.isActive()`), false);

      // no left-over key state: the menu keeps working and nothing threw
      assert.equal(await b.eval("window.__controls.gameInputEnabled"), true);

      assert.deepEqual(
        b.logs.filter((l) => l.type === "exception"),
        [],
        "no uncaught exceptions"
      );
    });
  });
});
