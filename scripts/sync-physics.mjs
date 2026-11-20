// The client uses a few pieces of server code, and keeps checked-in COPIES so
// it builds on its own wherever it is deployed (Vercel, Firebase, Docker...):
//
//   server/src/physics.ts   the physics rules, run by the client to predict
//                           the local player
//   server/src/profile.ts   how names are cleaned and which colours exist,
//                           so the client gives the same answer as the server
//
// The server's file is the source of truth.
//
//   node scripts/sync-physics.mjs          copy server -> client
//   node scripts/sync-physics.mjs --check  fail if they differ (CI, tests)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = ["physics.ts", "profile.ts"];

const normalise = (text) => text.replace(/\r\n/g, "\n");

let outOfDate = false;

for (const name of FILES) {

  const source = path.join(root, "server/src", name);

  const copy = path.join(root, "client/src/shared", name);

  const original = normalise(fs.readFileSync(source, "utf8"));

  if (process.argv.includes("--check")) {

    const existing = fs.existsSync(copy) ? normalise(fs.readFileSync(copy, "utf8")) : null;

    if (original !== existing) {
      console.error(`client/src/shared/${name} is out of date. Run: npm run sync:physics`);
      outOfDate = true;
    }

  } else {

    fs.mkdirSync(path.dirname(copy), { recursive: true });

    fs.copyFileSync(source, copy);

    console.log(`copied server/src/${name} -> client/src/shared/${name}`);
  }
}

if (process.argv.includes("--check")) {

  if (outOfDate) {
    process.exit(1);
  }

  console.log("shared copies are in sync");
}
