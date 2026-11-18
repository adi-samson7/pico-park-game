// The client and the game server on DIFFERENT origins, the way a static host
// (Vercel, Firebase Hosting, Netlify, S3...) plus a separate game server
// works:
//
//   https://game.example.com      static files only (the built client)
//   wss://play.example.com        the Colyseus game server
//
// The client is built with VITE_SERVER_URL pointing at the game server and is
// served by a plain static file server on another port. Everything the game
// needs must still work: the room lookup and matchmaking requests (CORS),
// the WebSocket, joining by code, and resuming after a reload.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { matchMaker } from "colyseus";

import type { App } from "../../src/app.js";

import { Bot, clientFor, startApp, waitFor } from "../helpers.js";

import { Browser, findChrome, sleep } from "./browser.js";

const clientDir = path.resolve(import.meta.dirname, "../../../client");

const viteBin = path.join(clientDir, "node_modules/vite/bin/vite.js");

const chrome = findChrome();

const skipReason: string | false =
  !chrome
    ? "no Chrome/Chromium found (set CHROME_PATH)"
    : !fs.existsSync(viteBin)
      ? "client dependencies are not installed (run `npm ci` in client/)"
      : false;

if (skipReason && process.env.E2E_REQUIRE) {
  throw new Error(`E2E_REQUIRE is set but: ${skipReason}`);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json"
};

describe("client on a static host, game server elsewhere", { skip: skipReason }, () => {

  let app: App;

  let staticServer: http.Server;

  let staticPort = 0;

  let outDir = "";

  let b: Browser;

  let bot: Bot | null = null;

  const menu = "window.__pico.scene.getScene('MenuScene')";
  const lobby = "window.__pico.scene.getScene('LobbyScene')";
  const game = "window.__pico.scene.getScene('GameScene')";

  const until = (fn: () => Promise<any>, what: string, ms = 8000) =>
    waitFor(fn, what, ms, 40);

  before(async () => {

    // The game server answers requests from other origins by default.
    app = await startApp();

    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pico-static-"));

    const build = spawnSync(
      process.execPath,
      [viteBin, "build", "--outDir", outDir, "--emptyOutDir"],
      {
        cwd: clientDir,
        env: {
          ...process.env,
          VITE_SERVER_URL: `http://127.0.0.1:${app.port}`
        },
        encoding: "utf8"
      }
    );

    assert.equal(build.status, 0, `client build failed:\n${build.stdout}\n${build.stderr}`);

    staticServer = http.createServer((req, res) => {

      const url = new URL(req.url ?? "/", "http://x");

      const file = path.join(outDir, url.pathname === "/" ? "index.html" : url.pathname);

      if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });

    await new Promise<void>((resolve) => staticServer.listen(0, "127.0.0.1", resolve));

    staticPort = (staticServer.address() as AddressInfo).port;

    b = await Browser.launch(chrome!);
  });

  after(async () => {

    await bot?.leave();

    await b?.close();

    await new Promise<void>((resolve) => {
      staticServer?.closeAllConnections?.();
      staticServer ? staticServer.close(() => resolve()) : resolve();
    });

    await app?.close();

    if (outDir) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("the build points at the game server, not at its own origin", async () => {

    const files = fs.readdirSync(path.join(outDir, "assets")).filter((f) => f.endsWith(".js"));

    const bundle = fs.readFileSync(path.join(outDir, "assets", files[0]), "utf8");

    assert.ok(bundle.includes(`127.0.0.1:${app.port}`), "the server address is compiled in");

    assert.notEqual(staticPort, app.port, "two different origins");
  });

  test("create a room, join it by code from another origin, start and play", async () => {

    await b.goto(`http://127.0.0.1:${staticPort}/?debug`);

    await until(() => b.eval(`${menu}.sys.isActive()`), "menu");

    const rect = await b.eval<{ x: number; y: number; w: number }>(
      "(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()"
    );

    await sleep(700);

    await b.click(rect.x + (400 * rect.w) / 800, rect.y + (280 * rect.w) / 800);

    await until(() => b.eval(`!!${lobby}.roomCode`), "room code (matchmaking across origins)");

    const code = await b.eval<string>(`${lobby}.roomCode`);

    // The room-code lookup from a page on another origin (CORS).
    const lookup = await b.eval<{ ok: boolean; roomId?: string }>(
      `fetch('http://127.0.0.1:${app.port}/room/${code}').then(async (r) => ({ ok: r.ok, roomId: (await r.json()).roomId }))`
    );

    assert.equal(lookup.ok, true, "cross-origin room lookup is allowed");

    bot = new Bot(await clientFor(app).joinById(lookup.roomId!));

    bot.startInput(16);

    await until(() => b.eval(`${lobby}.players.size === 2`), "both in the lobby");

    bot.room.send("toggleReady");

    await b.eval(`${lobby}.room.send('toggleReady')`);

    await until(async () => (matchMaker.getLocalRoomById(lookup.roomId!) as any).areAllPlayersReady(), "ready");

    await b.eval(`${lobby}.room.send('startGame')`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "game", 10000);

    await until(() => b.eval(`!!${game}.predictor.body`), "prediction running");

    // The ping chip works over the cross-origin socket too.
    await until(async () => (await b.eval<number | null>(`${game}.hud.meter.rtt`)) !== null, "ping measured");

    // The room the browser is in really is on the game server.
    assert.equal(
      await b.eval(`${game}.room.connection.url.startsWith('ws://127.0.0.1:${app.port}')`),
      true
    );
  });

  test("reloading the page on the static host resumes the game", async () => {

    const id = await b.eval<string>(`${game}.room.sessionId`);

    await b.goto(`http://127.0.0.1:${staticPort}/?debug`);

    await until(() => b.eval(`${game}.sys.isActive() && !!${game}.localPlayer`), "back in the game", 10000);

    assert.equal(await b.eval(`${game}.room.sessionId`), id);

    assert.equal(bot!.count("playerLeft"), 0);

    assert.deepEqual(
      b.logs.filter((l) => l.type === "exception"),
      [],
      "no uncaught exceptions"
    );
  });
});
