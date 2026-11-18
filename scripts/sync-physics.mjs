// The client predicts the local player with the SAME physics code the server
// runs. server/src/physics.ts is the source of truth; the client keeps a copy
// (client/src/shared/physics.ts) so it builds on its own, wherever it is
// deployed (Vercel, Firebase, Docker...).
//
//   node scripts/sync-physics.mjs          copy server -> client
//   node scripts/sync-physics.mjs --check  fail if they differ (CI, tests)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const source = path.join(root, "server/src/physics.ts");

const copy = path.join(root, "client/src/shared/physics.ts");

const normalise = (text) => text.replace(/\r\n/g, "\n");

const a = normalise(fs.readFileSync(source, "utf8"));

if (process.argv.includes("--check")) {

  const b = fs.existsSync(copy) ? normalise(fs.readFileSync(copy, "utf8")) : null;

  if (a !== b) {
    console.error(
      "client/src/shared/physics.ts is out of date. Run: npm run sync:physics"
    );
    process.exit(1);
  }

  console.log("physics copy is in sync");

} else {

  fs.mkdirSync(path.dirname(copy), { recursive: true });

  fs.copyFileSync(source, copy);

  console.log("copied server/src/physics.ts -> client/src/shared/physics.ts");
}
