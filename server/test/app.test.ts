import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { App } from "../src/app.js";

import { createRoom, startApp } from "./helpers.js";

// ==========================================
// HTTP: health, room lookup, static client
// ==========================================

describe("HTTP", () => {

  let app: App;

  let base = "";

  let dir = "";

  before(async () => {

    // A fake built client.

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pico-client-"));

    fs.mkdirSync(path.join(dir, "assets"));

    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>PICO</title>");

    fs.writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");

    app = await startApp({ staticDir: dir });

    base = `http://127.0.0.1:${app.port}`;
  });

  after(async () => {

    await app.close();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("listens on the requested interface and reports that it serves the client", () => {

    assert.ok(app.port > 0);
    assert.ok(app.servesClient);
  });

  test("GET /health", async () => {

    const res = await fetch(`${base}/health`);

    assert.equal(res.status, 200);

    const body = await res.json();

    assert.equal(body.status, "ok");
    assert.equal(typeof body.rooms, "number");
    assert.equal(typeof body.uptimeSeconds, "number");
  });

  test("security headers are set and X-Powered-By is hidden", async () => {

    const res = await fetch(`${base}/health`);

    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  describe("room lookup", () => {

    test("invalid codes are rejected", async () => {

      for (const code of ["abc", "TOOLONGCODE", "12345", "ab-cde"]) {

        const res = await fetch(`${base}/room/${code}`);

        assert.equal(res.status, 404, code);
        assert.equal((await res.json()).error, "Invalid room code.");
      }
    });

    test("unknown codes are 404", async () => {

      const res = await fetch(`${base}/room/ZZZZZZ`);

      assert.equal(res.status, 404);
      assert.equal((await res.json()).error, "Room not found");
    });

    test("a real code resolves to its room, case-insensitively", async () => {

      const host = await createRoom(app);

      try {

        const upper = await (await fetch(`${base}/room/${host.roomCode}`)).json();

        assert.equal(upper.roomId, host.room.roomId);
        assert.equal(upper.roomCode, host.roomCode);

        const lower = await (await fetch(`${base}/room/${host.roomCode.toLowerCase()}`)).json();

        assert.equal(lower.roomId, host.room.roomId);

        const health = await (await fetch(`${base}/health`)).json();

        assert.ok(health.rooms >= 1);

      } finally {

        await host.leave();
      }
    });

    test("a code stops resolving once its room is gone", async () => {

      const host = await createRoom(app);

      const code = host.roomCode;

      await host.leave();

      let status = 200;

      for (let i = 0; i < 50 && status === 200; i++) {

        await new Promise((r) => setTimeout(r, 50));

        status = (await fetch(`${base}/room/${code}`)).status;
      }

      assert.equal(status, 404);
    });

    test("CORS: preflight is answered and responses allow any origin by default", async () => {

      const pre = await fetch(`${base}/room/ZZZZZZ`, { method: "OPTIONS" });

      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get("access-control-allow-origin"), "*");

      const res = await fetch(`${base}/room/ZZZZZZ`);

      assert.equal(res.headers.get("access-control-allow-origin"), "*");
    });
  });

  describe("static client", () => {

    test("GET / serves index.html and revalidates", async () => {

      const res = await fetch(`${base}/`);

      assert.equal(res.status, 200);
      assert.match(await res.text(), /<title>PICO<\/title>/);
      assert.equal(res.headers.get("cache-control"), "no-cache");
    });

    test("fingerprinted assets are cached for a year", async () => {

      const res = await fetch(`${base}/assets/index-abc123.js`);

      assert.equal(res.status, 200);
      assert.match(res.headers.get("cache-control") ?? "", /max-age=31536000.*immutable/);
    });

    test("unknown paths are 404", async () => {

      assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    });

    test("path traversal cannot escape the client directory", async () => {

      const res = await fetch(`${base}/..%2f..%2fpackage.json`);

      assert.notEqual(res.status, 200);
    });
  });
});
