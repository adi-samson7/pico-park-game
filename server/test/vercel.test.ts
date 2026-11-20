import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

// Vercel serves only the static client; the game server lives elsewhere and the
// client learns its address from VITE_SERVER_URL at build time. The build must
// refuse to go on without a usable address, or the deployed game would silently
// look for its server on the Vercel site itself.

const clientDir = path.resolve(import.meta.dirname, "../../client");

const script = path.join(clientDir, "scripts/check-server-url.mjs");

function run(env: Record<string, string>) {

  const clean: NodeJS.ProcessEnv = { ...process.env };

  delete clean.VERCEL;
  delete clean.VITE_SERVER_URL;

  const result = spawnSync(process.execPath, [script], {
    env: { ...clean, ...env },
    encoding: "utf8"
  });

  return {
    status: result.status,
    text: result.stdout + result.stderr
  };
}

describe("the Vercel build guard", () => {

  test("on Vercel a missing server address stops the build, and says how to fix it", () => {

    const { status, text } = run({ VERCEL: "1" });

    assert.equal(status, 1);
    assert.match(text, /not set/);
    assert.match(text, /Environment Variables/);
    assert.match(text, /VITE_SERVER_URL=https:\/\//);
  });

  test("an empty or blank address counts as missing", () => {

    assert.equal(run({ VERCEL: "1", VITE_SERVER_URL: "" }).status, 1);
    assert.equal(run({ VERCEL: "1", VITE_SERVER_URL: "   " }).status, 1);
  });

  test("on Vercel the address must be https (a secure page cannot open ws://)", () => {

    const { status, text } = run({ VERCEL: "1", VITE_SERVER_URL: "http://pico.example.com" });

    assert.equal(status, 1);
    assert.match(text, /not https/);
  });

  test("an address that is not an address is refused", () => {

    for (const bad of ["pico.example.com", "not a url", "://nope", "ws://x.com", "ftp://x.com"]) {

      assert.equal(run({ VERCEL: "1", VITE_SERVER_URL: bad }).status, 1, bad);
    }
  });

  test("a good https address passes and is named in the build log", () => {

    const { status, text } = run({ VERCEL: "1", VITE_SERVER_URL: "https://pico-coop.onrender.com/" });

    assert.equal(status, 0);
    assert.match(text, /Game server: https:\/\/pico-coop\.onrender\.com/);
  });

  test("pointing at a Vercel site is allowed but warned about (it cannot run the server)", () => {

    const { status, text } = run({ VERCEL: "1", VITE_SERVER_URL: "https://my-game.vercel.app" });

    assert.equal(status, 0);
    assert.match(text, /Vercel cannot run the game server/);
  });

  test("outside Vercel (local builds, Docker) nothing is required", () => {

    assert.equal(run({}).status, 0);
    assert.equal(run({ VITE_SERVER_URL: "" }).status, 0);
    assert.equal(run({ VITE_SERVER_URL: "http://localhost:2567" }).status, 0);
  });
});

describe("the client build on its own", () => {

  test("is wired to run the guard first", () => {

    const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, "package.json"), "utf8"));

    assert.equal(pkg.scripts.prebuild, "node scripts/check-server-url.mjs");
    assert.match(pkg.scripts.build, /vite build/);
  });

  test("vercel.json describes a static Vite site", () => {

    const config = JSON.parse(fs.readFileSync(path.join(clientDir, "vercel.json"), "utf8"));

    assert.equal(config.framework, "vite");
    assert.equal(config.outputDirectory, "dist");
    assert.equal(config.buildCommand, "npm run build");

    // hashed assets are cached for good
    const assets = config.headers.find((h: any) => h.source.startsWith("/assets"));

    assert.match(assets.headers[0].value, /immutable/);
  });
});
