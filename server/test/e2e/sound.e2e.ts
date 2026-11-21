// Sound is on by default. In a real browser:
//
//   - a first-time visitor has sound ON
//   - the label does not claim "ON" while the browser still blocks sound
//     (it says a click is needed), and says ON once the first click unlocked it
//   - an "off" saved by an earlier release (key pico.muted) is not obeyed
//   - turning sound off is remembered from then on (key pico.muted.v2)
//
//   npm run build   (in client/)   then   npm run test:e2e   (in server/)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { App } from "../../src/app.js";

import { startApp, waitFor } from "../helpers.js";

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

describe("sound is on by default (real browser)", { skip: skipReason }, () => {

  let app: App;

  let b: Browser;

  const menu = "window.__pico.scene.getScene('MenuScene')";

  const until = (fn: () => Promise<any>, what: string, ms = 6000) =>
    waitFor(fn, what, ms, 30);

  const soundLabel = () =>
    b.eval<string>(
      `(${menu}.children.list.find((c) => c.type === 'Text' && c.text.startsWith('SOUND')) || { text: '' }).text`
    );

  const open = async () => {

    await b.goto(`http://127.0.0.1:${app.port}/?debug`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    await sleep(500);
  };

  const clickCanvas = async () => {

    const rect = await b.eval<{ x: number; y: number }>(
      "(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 30 }; })()"
    );

    await b.click(rect.x, rect.y);
  };

  before(async () => {

    app = await startApp({ staticDir: clientDist });

    b = await Browser.launch(chrome!);

    await open();

    await b.eval("localStorage.clear(); sessionStorage.clear();");

    await open();
  });

  after(async () => {

    await b?.close();

    await app?.close();
  });

  test("a first-time visitor has sound on", async () => {

    assert.equal(await b.eval("window.__audio.isMuted"), false);

    assert.equal(await b.eval("localStorage.getItem('pico.muted.v2')"), null, "no choice saved yet");
  });

  test("before the first click the label says what is needed, not just ON", async () => {

    assert.equal(await b.eval("window.__audio.running"), false, "the browser blocks sound until a click");

    assert.match(await soundLabel(), /CLICK ANYWHERE TO START/);
  });

  test("after the first click the sound is running and the label says ON", async () => {

    await clickCanvas();

    await until(() => b.eval("window.__audio.running"), "sound unlocked");

    await until(async () => (await soundLabel()) === "SOUND: ON [M]", "label updated");
  });

  test("an 'off' saved by an earlier release is ignored, and the old key is cleaned up", async () => {

    await b.eval("localStorage.setItem('pico.muted', '1')");

    await open();

    assert.equal(await b.eval("window.__audio.isMuted"), false, "sound is on despite the old choice");

    assert.equal(await b.eval("localStorage.getItem('pico.muted')"), null, "the old key is removed");
  });

  test("turning sound off is remembered, and turning it on again too", async () => {

    await clickCanvas();

    await until(() => b.eval("window.__audio.running"), "unlocked");

    // M toggles
    await b.tap("KeyM", "m");

    await until(() => b.eval("window.__audio.isMuted"), "muted");

    assert.equal(await b.eval("localStorage.getItem('pico.muted.v2')"), "1");

    await open();

    assert.equal(await b.eval("window.__audio.isMuted"), true, "still off after a reload");

    assert.equal(await soundLabel(), "SOUND: OFF [M]");

    await clickCanvas();

    await b.tap("KeyM", "m");

    await until(async () => !(await b.eval<boolean>("window.__audio.isMuted")), "on again");

    assert.equal(await b.eval("localStorage.getItem('pico.muted.v2')"), "0");

    await open();

    assert.equal(await b.eval("window.__audio.isMuted"), false, "on after a reload");
  });

  test("a browser that refuses storage still starts with sound on, and nothing breaks", async () => {

    // Storage that throws on every access, from before the game loads
    // (private modes and blocked cookies do this).
    const { identifier } = await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });"
    });

    try {

      await open();

      assert.equal(await b.eval("window.__audio.isMuted"), false, "sound is on");

      assert.equal(await b.eval(`${menu}.sys.isActive()`), true, "the menu works");

      // switching it off still works for this visit
      await clickCanvas();

      await b.tap("KeyM", "m");

      await until(() => b.eval("window.__audio.isMuted"), "muted for this visit");

      assert.deepEqual(
        b.logs.filter((l) => l.type === "exception"),
        [],
        "no uncaught exceptions"
      );

    } finally {

      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  });
});
