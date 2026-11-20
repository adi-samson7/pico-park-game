import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";

// ==========================================
// CONFIGURATION (environment variables)
// ==========================================
//
//   PORT          port to listen on        (2567)
//   HOST          interface to bind to     (0.0.0.0)
//   CLIENT_DIST   built client directory   (../../client/dist)
//   CORS_ORIGIN   allowed origin for the
//                 room lookup endpoint     (*)

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

const app =
  await createApp({
    port,
    host,
    staticDir,
    corsOrigin:
      process.env.CORS_ORIGIN
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
  app.servesClient
    ? `Serving client from ${staticDir}`
    : "Client not served (run `npm run dev` in client/ for development)"
);

console.log(
  "================================"
);
