import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";

import {
  Leaderboard,
  fileStore
} from "./leaderboard.js";

// ==========================================
// CONFIGURATION (environment variables)
// ==========================================
//
//   PORT          port to listen on        (2567)
//   HOST          interface to bind to     (0.0.0.0)
//   CLIENT_DIST   built client directory   (../../client/dist)
//   CORS_ORIGIN   allowed origin for the
//                 room lookup endpoint     (*)
//   DATA_DIR      where the leaderboard is
//                 kept            (./data in the
//                 working directory)

const port =
  Number(
    process.env.PORT ?? 2567
  );

const host =
  process.env.HOST ??
  "0.0.0.0";

const staticDir =
  process.env.CLIENT_DIST ??
  fileURLToPath(
    new URL(
      "../../client/dist",
      import.meta.url
    )
  );

if (
  !Number.isInteger(port) ||
  port < 0 ||
  port > 65535
) {

  console.error(
    `Invalid PORT: ${process.env.PORT}`
  );

  process.exit(1);
}

// ==========================================
// START
// ==========================================

const dataDir =
  path.resolve(
    process.env.DATA_DIR ??
      "data"
  );

const leaderboardFile =
  path.join(
    dataDir,
    "leaderboard.json"
  );

const app =
  await createApp({
    port,
    host,
    staticDir,
    corsOrigin:
      process.env.CORS_ORIGIN,
    leaderboard:
      new Leaderboard(
        fileStore(
          leaderboardFile
        )
      )
  });

console.log(
  "================================"
);

console.log(
  "PICO CO-OP SERVER RUNNING"
);

console.log(
  `Game + lookup: http://${host}:${app.port}`
);

console.log(
  `Leaderboard file: ${leaderboardFile}`
);

console.log(
  app.servesClient
    ? `Serving client from ${staticDir}`
    : "Client not served (run `npm run dev` in client/ for development)"
);

console.log(
  "================================"
);
