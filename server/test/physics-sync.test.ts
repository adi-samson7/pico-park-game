import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// The client predicts the local player with its own copy of the server's
// physics. If the two ever differ, prediction disagrees with the server and
// players get pulled back all the time. Edit server/src/physics.ts, then run
// `npm run sync:physics` at the repository root.

const root = path.resolve(import.meta.dirname, "../..");

const read = (file: string) =>
  fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("the client's copy of the physics is identical to the server's", () => {

  assert.equal(
    read("client/src/shared/physics.ts"),
    read("server/src/physics.ts"),
    "client/src/shared/physics.ts is out of date: run `npm run sync:physics`"
  );
});

test("the client's prediction imports the copy, not the server's file", () => {

  const prediction = read("client/src/net/prediction.ts");

  assert.match(prediction, /from "\.\.\/shared\/physics\.ts"/);

  assert.doesNotMatch(
    prediction,
    /from\s+"[^"]*server[^"]*"/,
    "the client must build without the server's sources"
  );
});
