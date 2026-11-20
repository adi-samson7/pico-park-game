import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// The client keeps copies of two server files:
//
//   physics.ts  it predicts the local player with the server's physics; if the
//               two differ, players get pulled back all the time
//   profile.ts  how names are cleaned and which colours exist; if the two
//               differ, the client accepts names the server then changes
//
// Edit the server's file, then run `npm run sync:physics` at the repository
// root.

const root = path.resolve(import.meta.dirname, "../..");

const read = (file: string) =>
  fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

for (const name of ["physics.ts", "profile.ts"]) {

  test(`the client's copy of ${name} is identical to the server's`, () => {

    assert.equal(
      read(`client/src/shared/${name}`),
      read(`server/src/${name}`),
      `client/src/shared/${name} is out of date: run \`npm run sync:physics\``
    );
  });
}

test("the client imports the copies, not the server's files", () => {

  const files = [
    "client/src/net/prediction.ts",
    "client/src/profile.ts"
  ];

  for (const file of files) {

    const source = read(file);

    assert.doesNotMatch(
      source,
      /from\s+"[^"]*server[^"]*"/,
      `${file}: the client must build without the server's sources`
    );
  }

  assert.match(read("client/src/net/prediction.ts"), /from "\.\.\/shared\/physics\.ts"/);
});
