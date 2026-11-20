// Netcode in a real browser: headless Chrome plays the production build
// THROUGH A MISBEHAVING NETWORK (test/e2e/proxy.ts) against a scripted bot.
//
//   - ping chip + latency numbers
//   - prediction: the local player reacts before a round trip is over
//   - interpolation: other players move smoothly on a jittery connection
//   - outages: the player keeps their seat and comes back
//   - page reload: the game resumes where it was
//   - giving up, leaving on purpose, and stale sessions
//
//   npm run build   (in client/)   then   npm run test:e2e   (in server/)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";

import { matchMaker } from "colyseus";

import type { App } from "../../src/app.js";

import { Bot, clientFor, startApp, waitFor } from "../helpers.js";

import { Browser, findChrome, sleep } from "./browser.js";

import { LagProxy } from "./proxy.js";

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

describe("netcode in a real browser (laggy network)", { skip: skipReason }, () => {

  let app: App;

  let proxy: LagProxy;

  let b: Browser;

  let bot: Bot | null = null;

  const game = "window.__pico.scene.getScene('GameScene')";

  const lobby = "window.__pico.scene.getScene('LobbyScene')";

  const menu = "window.__pico.scene.getScene('MenuScene')";

  const until = (fn: () => Promise<any>, what: string, ms = 6000) =>
    waitFor(fn, what, ms, 30);

  let rect = { x: 0, y: 0, w: 800 };

  const click = (gx: number, gy: number) =>
    b.click(rect.x + (gx * rect.w) / 800, rect.y + (gy * rect.w) / 800);

  /** Clicks the middle of a game object, wherever the layout put it. */
  const clickObject = async (expression: string) => {

    const c = await b.eval<{ x: number; y: number }>(
      `(() => { const r = ${expression}.getBounds(); return { x: r.centerX, y: r.centerY }; })()`
    );

    await click(c.x, c.y);
  };

  /** The server's own record of a player. */
  const serverPlayer = (roomId: string, id: string) =>
    (matchMaker.getLocalRoomById(roomId) as any)?.players.get(id);

  before(async () => {

    // Short, so abandoned rooms of finished tests clear quickly.
    process.env.RECONNECT_WINDOW_SECONDS = "6";

    app = await startApp({ staticDir: clientDist });

    proxy = await LagProxy.start({ host: "127.0.0.1", port: app.port }, 7);

    b = await Browser.launch(chrome!);
  });

  afterEach(async () => {

    proxy.blocked = false;
    proxy.oneWayMs = 0;
    proxy.jitterMs = 0;

    await bot?.leave();

    bot = null;
  });

  after(async () => {

    delete process.env.RECONNECT_WINDOW_SECONDS;

    await b?.close();

    await proxy?.close();

    await app?.close();
  });

  // ---- scenario ----

  /** Opens the game through the proxy, creates a room by clicking, lets
   *  the bot join, and starts the game. */
  async function startMatch(options: { query?: string; startGame?: boolean } = {}) {

    const began = Date.now();

    const mark = (what: string) =>
      process.env.NET_DEBUG && console.log(`  [startMatch +${Date.now() - began} ms] ${what}`);

    const startGame = options.startGame ?? true;

    // A fresh tab: forget any session of the previous test.
    await b.goto("about:blank");
    await b.goto(proxy.url + "/robots.txt");
    await b.eval("sessionStorage.clear()");

    await b.goto(`${proxy.url}/?debug${options.query ?? ""}`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    mark("menu");

    rect = await b.eval(
      "(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()"
    );

    // Let the menu finish fading in, then click CREATE ROOM (once more if
    // the first click landed while the page was still settling).

    await sleep(700);

    for (let attempt = 1; ; attempt++) {

      await clickObject(`${menu}.createButton`);

      try {
        await waitFor(() => b.eval(`!!${lobby}.roomCode`), "room code", 3000, 30);
        break;
      } catch (error) {

        if (attempt >= 3) {
          console.log("browser log at failure:", JSON.stringify(b.logs.slice(-12)));
          throw error;
        }
      }
    }

    mark("room created");

    const code = await b.eval<string>(`${lobby}.roomCode`);

    const { roomId } = await (await fetch(`http://127.0.0.1:${app.port}/room/${code}`)).json();

    bot = new Bot(await clientFor(app).joinById(roomId));

    bot.startInput(16);

    await until(() => b.eval(`${lobby}.players.size === 2`), "both players in the lobby");

    if (!startGame) {
      return { roomId, code };
    }

    mark("bot joined");

    bot.room.send("toggleReady");

    await b.eval(`${lobby}.room.send('toggleReady')`);

    await until(async () => (matchMaker.getLocalRoomById(roomId) as any).areAllPlayersReady(), "everyone ready");

    await b.eval(`${lobby}.room.send('startGame')`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "game scene", 8000);

    mark("game scene");

    // Wait until the local player has landed.
    await until(
      () => b.eval(`(() => { const s = ${game}; const f = s.playerFx.get(s.room.sessionId); return !!f && f.grounded; })()`),
      "landed",
      8000
    );

    await sleep(300);

    return { roomId, code };
  }

  const sessionId = () => b.eval<string>(`${game}.room.sessionId`);

  const localX = () => b.eval<number>(`${game}.localPlayer.x`);

  /** Page-clock milliseconds from pressing a key until the local player's
   *  picture has moved, measured by the page itself. */
  async function reactionTime(key = "ArrowLeft"): Promise<number> {

    await b.eval(`(() => {
      const s = ${game};
      const w = (window.__react = { x0: s.localPlayer.x, at: null });
      const watch = () => {
        if (w.at === null && Math.abs(s.localPlayer.x - w.x0) > 1) { w.at = performance.now(); }
        if (w.at === null) { requestAnimationFrame(watch); }
      };
      requestAnimationFrame(watch);
    })()`);

    const pressed = await b.eval<number>("performance.now()");

    // Short taps only: the ledge under the spawn point ends just to its
    // right, and a tap moves the player a few pixels at most.
    await b.key(key, key, true);

    await until(() => b.eval("window.__react.at !== null"), "the picture moved", 3000);

    const moved = await b.eval<number>("window.__react.at");

    await b.key(key, key, false);

    return moved - pressed;
  }

  // ==========================================
  // LATENCY
  // ==========================================

  test("the ping chip shows the round trip, and everyone gets to see everyone's ping", async () => {

    proxy.oneWayMs = 60;

    const { roomId } = await startMatch({ startGame: false });

    // 2 x 60 ms plus processing
    await until(
      async () => ((await b.eval<number | null>(`${lobby}.hud.meter.rtt`)) ?? 0) >= 110,
      "the page measured its round trip"
    );

    const chip = await b.eval<string>(`${lobby}.hud.chip.text`);

    assert.match(chip, /^● \d+ ms$/);

    const id = await b.eval<string>(`${lobby}.room.sessionId`);

    // ...reported to the server, and passed on to the other player
    await until(async () => (bot!.last("latencies")?.rtts[id] ?? 0) >= 110, "the bot sees the browser's ping");

    // The bot's own report comes back to the page
    bot!.room.send("latency", { rtt: 33 });

    await until(
      () => b.eval(`${lobby}.hud.rtts.get(${JSON.stringify(bot!.id)}) === 33`),
      "the page sees the bot's ping"
    );

    assert.ok(serverPlayer(roomId, id));
  });

  // ==========================================
  // PREDICTION
  // ==========================================

  test("with prediction the local player reacts at once, however slow the network", async () => {

    proxy.oneWayMs = 150; // 300 ms round trip

    await startMatch();

    // Best of three: a prediction that does not work is slow every time,
    // while one stalled frame on a busy machine only spoils one sample.
    // Alternating directions keeps the player on their ledge.
    const samples: number[] = [];

    for (const direction of ["ArrowLeft", "ArrowRight", "ArrowLeft"]) {

      samples.push(await reactionTime(direction));

      await sleep(250);
    }

    const delay = Math.min(...samples);

    assert.ok(
      delay < 120,
      `reacted after ${delay.toFixed(0)} ms on a 300 ms connection (samples: ${samples.map((x) => x.toFixed(0)).join(", ")})`
    );

    // ...and the server agrees in the end
    await sleep(1500);

    const stats = await b.eval<any>(`${game}.predictor.stats`);

    const id = await sessionId();

    const roomId = await b.eval<string>(`${game}.room.roomId`);

    const server = serverPlayer(roomId, id);

    const shown = await b.eval<{ x: number; y: number }>(`(() => { const p = ${game}.localPlayer; return { x: p.x, y: p.y - 30 }; })()`);

    assert.ok(
      Math.hypot(shown.x - server.x, shown.y - server.y) < 3,
      `picture (${shown.x.toFixed(1)}, ${shown.y.toFixed(1)}) vs server (${server.x.toFixed(1)}, ${server.y.toFixed(1)})`
    );

    assert.ok(stats.checked > 20, `the prediction was checked against the server ${stats.checked} times`);
  });

  test("without prediction (?predict=0) the same connection feels a full round trip late", async () => {

    proxy.oneWayMs = 150;

    await startMatch({ query: "&predict=0" });

    const delay = await reactionTime();

    assert.ok(delay > 250, `reacted after ${delay.toFixed(0)} ms: the round trip is felt`);
  });

  test("the local player is never moved by the server while nothing is wrong", async () => {

    proxy.oneWayMs = 60;
    proxy.jitterMs = 40;

    await startMatch();

    // Walk right for a second and watch the picture frame by frame.
    await b.eval(`(() => {
      const s = ${game};
      const w = (window.__trace = { xs: [], ts: [], run: true });
      const frame = (now) => {
        w.xs.push(s.localPlayer.x);
        w.ts.push(now);
        if (w.run) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    })()`);

    // Walk left and jump on the way: the ledge under the spawn point is
    // wide enough to stay on it, and the jump exercises the vertical
    // prediction, the double jump and the landing too.
    await b.key("ArrowLeft", "ArrowLeft", true);

    await sleep(200);

    await b.tap("Space", " ", 40);

    await sleep(250);

    await b.tap("Space", " ", 40);

    await sleep(350);

    await b.key("ArrowLeft", "ArrowLeft", false);

    await sleep(900);

    const { xs, ts } = await b.eval<{ xs: number[]; ts: number[] }>(
      "(() => { window.__trace.run = false; return window.__trace; })()"
    );

    // Never a sudden jump (a correction by the server would show as one),
    // and the player really moved. Judged by SPEED between frames, so a
    // frame that arrives late (a busy machine) is not mistaken for a jump.

    let fastest = 0;

    for (let i = 1; i < xs.length; i++) {

      const seconds = (ts[i] - ts[i - 1]) / 1000;

      if (seconds > 0) {
        fastest = Math.max(fastest, Math.abs(xs[i] - xs[i - 1]) / seconds);
      }
    }

    const lowest = Math.min(...xs);

    assert.ok(xs[0] - lowest > 40, `the player walked ${(xs[0] - lowest).toFixed(0)} px`);

    // Walking is 220 px/s. A visible correction is thousands.
    assert.ok(fastest < 600, `fastest movement between frames: ${fastest.toFixed(0)} px/s`);
  });

  // ==========================================
  // INTERPOLATION
  // ==========================================

  async function remoteSteps(): Promise<{
    biggest: number;
    moved: number;
    stalls: number;
    roughness: number;
  }> {

    // The bot walks right while the browser watches the bot's sprite.

    await b.eval(`(() => {
      const s = ${game};
      const sprite = s.remotePlayers.get(${JSON.stringify(bot!.id)});
      const w = (window.__remote = { xs: [], ts: [], run: true });
      const frame = (now) => { w.xs.push(sprite.x); w.ts.push(now); if (w.run) requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    })()`);

    bot!.input = { right: true };

    await sleep(900);

    bot!.input = {};

    await sleep(500);

    const { xs, ts } = await b.eval<{ xs: number[]; ts: number[] }>(
      "(() => { window.__remote.run = false; return window.__remote; })()"
    );

    // Only the frames while the bot was walking.

    const first = xs.findIndex((x) => Math.abs(x - xs[0]) > 3);

    let last = xs.length - 1;

    while (last > 0 && Math.abs(xs[last] - xs[last - 1]) < 0.01) {
      last--;
    }

    // Speed (px/s) between frames, so a late frame is not read as a jump.
    const steps: number[] = [];

    for (let i = Math.max(1, first + 5); i <= last - 5; i++) {

      const seconds = (ts[i] - ts[i - 1]) / 1000;

      if (seconds > 0) {
        steps.push((xs[i] - xs[i - 1]) / seconds);
      }
    }

    const mean = steps.reduce((a, c) => a + c, 0) / Math.max(1, steps.length);

    // How unevenly it moves: standard deviation of the per-frame step.
    const roughness = Math.sqrt(
      steps.reduce((a, c) => a + (c - mean) ** 2, 0) / Math.max(1, steps.length)
    );

    // Frames where it stood still in the middle of walking.
    const stalls = steps.filter((d) => Math.abs(d) < 18).length;

    const biggest = steps.reduce((a, c) => Math.max(a, Math.abs(c)), 0);

    if (process.env.NET_DEBUG) {
      console.log("remote steps", JSON.stringify({ frames: steps.length, mean: +mean.toFixed(2), roughness: +roughness.toFixed(2), stalls, biggest: +biggest.toFixed(1) }));
    }

    return { biggest, moved: xs[xs.length - 1] - xs[0], stalls, roughness };
  }

  test("other players move smoothly even when the connection is jittery", async () => {

    proxy.oneWayMs = 40;
    proxy.jitterMs = 80;

    await startMatch();

    const smooth = await remoteSteps();

    assert.ok(smooth.moved > 80, `the bot walked ${smooth.moved.toFixed(0)} px`);

    // The bot walks at 220 px/s; on a jittery connection the picture must
    // stay near that, never lurching (speeds in px/s).
    assert.ok(smooth.biggest < 800, `fastest movement between frames: ${smooth.biggest.toFixed(0)} px/s`);
    assert.ok(smooth.roughness < 180, `unevenness of the motion: ${smooth.roughness.toFixed(0)} px/s`);
  });

  // ==========================================
  // OUTAGES
  // ==========================================

  test("an outage: the veil appears, the other player sees them as away, and they come back as themselves", async () => {

    const { roomId } = await startMatch();

    const id = await sessionId();

    proxy.blocked = true;
    proxy.dropAll();

    // the page notices
    await until(() => b.eval(`${game}.hud.offline`), "the page notices the outage");

    assert.equal(await b.eval(`${game}.hud.veil.visible`), true, "the veil is up");
    assert.match(await b.eval(`${game}.hud.message.text`), /CONNECTION LOST/);
    assert.match(await b.eval(`${game}.hud.chip.text`), /offline/);

    // the server holds the seat, and tells the bot
    await until(async () => bot!.events.some((e) => e.type === "playerDropped" && e.data.id === id), "bot told");

    await until(
      async () => bot!.state?.players.find((p) => p.id === id)?.connected === false,
      "bot's state marks the player as away"
    );

    assert.equal(bot!.count("playerLeft"), 0, "a drop is not a leave");

    await sleep(500);

    // the network comes back
    proxy.blocked = false;

    await until(async () => !(await b.eval<boolean>(`${game}.hud.offline`)), "the page reconnects", 10000);

    assert.equal(await sessionId(), id, "same seat");
    assert.equal(await b.eval(`${game}.hud.veil.visible`), false, "the veil is gone");

    await until(async () => bot!.events.some((e) => e.type === "playerReconnected" && e.data.id === id), "bot told");

    assert.equal(bot!.count("playerLeft"), 0);

    // The server put them back at their spawn point: they drop in again.
    await until(() => b.eval(`!!${game}.predictor.body`), "prediction restarted");

    await until(
      () => b.eval(`(() => { const s = ${game}; const f = s.playerFx.get(s.room.sessionId); return !!f && f.grounded; })()`),
      "landed again",
      8000
    );

    const before = await localX();

    await b.key("ArrowLeft", "ArrowLeft", true);

    await sleep(500);

    await b.key("ArrowLeft", "ArrowLeft", false);

    assert.ok((await localX()) < before - 40, "the player walks again");

    // and the server saw it: once the last inputs have arrived and been
    // checked, the picture and the server agree (given a moment, not a fixed
    // number of milliseconds: a busy machine delays the last state)
    assert.equal(serverPlayer(roomId, id).connected, true);

    await until(
      async () => {
        const shown = await b.eval<number>(`${game}.localPlayer.x`);
        return Math.abs(shown - serverPlayer(roomId, id).x) < 3;
      },
      "the picture agrees with the server",
      4000
    );

    const errors = b.logs.filter((l) => l.type === "exception");

    assert.deepEqual(errors, [], "no uncaught exceptions");
  });

  test("the other player is shown as away, then back", async () => {

    await startMatch();

    // The bot drops: the browser must grey out its sprite. Its library
    // waits a few seconds before it tries again, so there is time to look.
    const botId = bot!.id;

    bot!.room.reconnection.delay = 1500;
    bot!.room.reconnection.minDelay = 1500;

    bot!.drop();

    await until(
      () => b.eval(`${game}.ghostLabels.has(${JSON.stringify(botId)})`),
      "the bot's sprite is marked as away"
    );

    assert.equal(
      await b.eval(`${game}.remotePlayers.get(${JSON.stringify(botId)}).alpha < 0.5`),
      true,
      "greyed out"
    );

    // the bot's library reconnects by itself
    await until(
      async () => !(await b.eval<boolean>(`${game}.ghostLabels.has(${JSON.stringify(botId)})`)),
      "away tag removed",
      8000
    );

    assert.equal(
      await b.eval(`${game}.remotePlayers.get(${JSON.stringify(botId)}).alpha`),
      1,
      "back to full colour"
    );
  });

  test("giving up: after the last attempt the player is told and returned to the menu", async () => {

    await startMatch({ query: "&retries=2" });

    proxy.blocked = true;
    proxy.dropAll();

    await until(() => b.eval(`${menu}.sys.isActive()`), "back at the menu", 15000);

    await until(
      () => b.eval(`${menu}.children.list.some(c => c.type === 'Text' && /Connection to the game was lost/.test(c.text))`),
      "explanation on screen"
    );

    assert.equal(await b.eval("sessionStorage.getItem('pico.session')"), null, "nothing left to resume");
  });

  // ==========================================
  // PAGE RELOAD
  // ==========================================

  test("reloading the page in a game puts the player back in it", async () => {

    const { roomId } = await startMatch();

    const id = await sessionId();

    assert.ok(await b.eval("sessionStorage.getItem('pico.session')"), "the tab remembers the room");

    // Collect a crystal so there is progress to preserve.
    await sleep(500);

    const scoreBefore = (matchMaker.getLocalRoomById(roomId) as any).score as number;

    await b.goto(`${proxy.url}/?debug`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "back in the game after the reload", 10000);

    assert.equal(await sessionId(), id, "same seat in the same room");

    await until(
      async () => bot!.events.some((e) => e.type === "playerReconnected" && e.data.id === id),
      "bot told the player is back"
    );

    assert.equal(bot!.count("playerLeft"), 0);

    // the level and the score were restored
    await until(() => b.eval(`${game}.shownLevel === 1`), "level shown");

    const crystals = await b.eval<number>(`${game}.crystalSprites.size`);

    const room = matchMaker.getLocalRoomById(roomId) as any;

    const remaining = [...room.crystals.values()].filter((c: any) => !c.collected).length;

    assert.equal(crystals, remaining, "only the crystals still in the level are shown");

    assert.ok(room.score >= scoreBefore, "progress kept");

    // and it plays
    await until(() => b.eval(`!!${game}.predictor.body`), "prediction running");

    await until(
      () => b.eval(`(() => { const s = ${game}; const f = s.playerFx.get(s.room.sessionId); return !!f && f.grounded; })()`),
      "landed again",
      8000
    );

    const x = await localX();

    await b.key("ArrowLeft", "ArrowLeft", true);

    await sleep(500);

    await b.key("ArrowLeft", "ArrowLeft", false);

    assert.ok((await localX()) < x - 40, "the resumed player walks");

    assert.deepEqual(b.logs.filter((l) => l.type === "exception"), []);
  });

  test("reloading the page in the lobby puts the player back in the lobby", async () => {

    const { roomId, code } = await startMatch({ startGame: false });

    bot!.room.send("toggleReady");

    await until(async () => (matchMaker.getLocalRoomById(roomId) as any).players.get(bot!.id).ready, "bot ready");

    const id = await b.eval<string>(`${lobby}.room.sessionId`);

    await b.goto(`${proxy.url}/?debug`);

    await until(() => b.eval(`${lobby}.sys.isActive() && ${lobby}.players.size === 2`), "back in the lobby", 10000);

    assert.equal(await b.eval(`${lobby}.room.sessionId`), id);

    assert.equal(await b.eval(`${lobby}.roomCode`), code);

    assert.equal(await b.eval(`${lobby}.players.get(${JSON.stringify(bot!.id)}).ready`), true, "the bot's ready state is shown");

    // The host role moved to the bot the moment the host's connection
    // dropped, so the lobby can never wait for someone who is gone.
    assert.equal(await b.eval(`${lobby}.hostId`), bot!.id, "the bot is the host now");

    assert.equal(bot!.count("playerLeft"), 0);
  });

  test("leaving on purpose forgets the room: a reload starts at the menu", async () => {

    await startMatch({ startGame: false });

    assert.ok(await b.eval("sessionStorage.getItem('pico.session')"));

    await clickObject(`${lobby}.leaveButton`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    assert.equal(await b.eval("sessionStorage.getItem('pico.session')"), null);

    await b.goto(`${proxy.url}/?debug`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu after reload");

    await sleep(800);

    assert.equal(await b.eval(`${lobby}.sys.isActive()`), false, "no attempt to rejoin");
  });

  test("a stale session is dropped quietly", async () => {

    await b.goto("about:blank");
    await b.goto(proxy.url + "/robots.txt");

    await b.eval(
      `sessionStorage.setItem('pico.session', JSON.stringify({ token: 'nosuchroom:nosuchtoken', roomCode: 'AAAAAA', savedAt: Date.now() }))`
    );

    await b.goto(`${proxy.url}/?debug`);

    await until(
      () => b.eval(`${menu}.children.list.some(c => c.type === 'Text' && /Could not rejoin/.test(c.text))`),
      "message about the failed rejoin",
      8000
    );

    assert.equal(await b.eval("sessionStorage.getItem('pico.session')"), null, "forgotten");

    assert.equal(await b.eval(`${menu}.sys.isActive()`), true, "still usable");

    assert.deepEqual(b.logs.filter((l) => l.type === "exception"), []);
  });

  test("a stored session that is garbage never breaks the menu", async () => {

    await b.goto("about:blank");
    await b.goto(proxy.url + "/robots.txt");

    await b.eval(`sessionStorage.setItem('pico.session', '{{{ not json')`);

    await b.goto(`${proxy.url}/?debug`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    assert.equal(await b.eval("sessionStorage.getItem('pico.session')"), null);
  });
});
