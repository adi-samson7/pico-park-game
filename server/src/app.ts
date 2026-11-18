import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

import express from "express";

import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { GameRoom } from "./rooms/GameRoom.js";

import {
  findRoom,
  roomCount
} from "./roomRegistry.js";

// ==========================================
// OPTIONS
// ==========================================

export interface AppOptions {

  // TCP port. 0 picks a free one (tests).
  port: number;

  // Interface to bind to.
  host?: string;

  // Directory holding the built client
  // (index.html + assets). Optional: in
  // development Vite serves the client.
  staticDir?: string;

  // Value of Access-Control-Allow-Origin
  // for the room lookup endpoint.
  corsOrigin?: string;

  // Print the Colyseus banner.
  greet?: boolean;

  // Let Colyseus shut down on SIGINT /
  // SIGTERM. Turn off in tests.
  handleSignals?: boolean;
}

export interface App {

  server: Server;

  // The port actually listened on.
  port: number;

  // True if the built client is served.
  servesClient: boolean;

  close(): Promise<void>;
}

// ==========================================
// ROUTES
// ==========================================

const ROOM_CODE =
  /^[A-Za-z0-9]{6}$/;

function registerRoutes(
  app: express.Application,
  options: AppOptions,
  startedAt: number
): boolean {

  app.disable(
    "x-powered-by"
  );

  // ----------------------------------------
  // SECURITY HEADERS
  // ----------------------------------------

  app.use(
    (_req, res, next) => {

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      res.setHeader(
        "Referrer-Policy",
        "no-referrer"
      );

      next();
    }
  );

  // ----------------------------------------
  // HEALTH (load balancers / orchestrators)
  // ----------------------------------------

  app.get(
    "/health",
    (_req, res) => {

      res.json({

        status:
          "ok",

        rooms:
          roomCount(),

        uptimeSeconds:
          Math.round(
            (Date.now() - startedAt) /
              1000
          )
      });
    }
  );

  // ----------------------------------------
  // ROOM LOOKUP: code -> Colyseus room id
  // ----------------------------------------

  app.use(
    "/room",
    (req, res, next) => {

      res.setHeader(
        "Access-Control-Allow-Origin",
        options.corsOrigin ?? "*"
      );

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      if (req.method === "OPTIONS") {

        res.sendStatus(
          204
        );

        return;
      }

      next();
    }
  );

  app.get(
    "/room/:code",
    (req, res) => {

      const code =
        String(
          req.params.code
        );

      if (!ROOM_CODE.test(code)) {

        res.status(404).json({
          error:
            "Invalid room code."
        });

        return;
      }

      const roomCode =
        code.toUpperCase();

      const roomId =
        findRoom(
          roomCode
        );

      if (!roomId) {

        res.status(404).json({
          error:
            "Room not found"
        });

        return;
      }

      res.json({
        roomId,
        roomCode
      });
    }
  );

  // ----------------------------------------
  // BUILT CLIENT
  // ----------------------------------------

  const staticDir =
    options.staticDir;

  if (
    staticDir &&
    fs.existsSync(
      path.join(
        staticDir,
        "index.html"
      )
    )
  ) {

    app.use(
      express.static(
        staticDir,
        {
          setHeaders: (
            res,
            filePath
          ) => {

            // Vite fingerprints everything in
            // /assets, so it can be cached for
            // good; index.html must always be
            // revalidated to pick up new builds.

            res.setHeader(
              "Cache-Control",
              filePath.includes(
                `${path.sep}assets${path.sep}`
              )
                ? "public, max-age=31536000, immutable"
                : "no-cache"
            );
          }
        }
      )
    );

    return true;
  }

  return false;
}

// ==========================================
// CREATE APP
// ==========================================

export async function createApp(
  options: AppOptions
): Promise<App> {

  const startedAt =
    Date.now();

  let servesClient =
    false;

  const server =
    new Server({

      transport:
        new WebSocketTransport(),

      greet:
        options.greet ?? true,

      gracefullyShutdown:
        options.handleSignals ?? true,

      express: (app) => {

        servesClient =
          registerRoutes(
            app,
            options,
            startedAt
          );
      }
    });

  server.define(
    "game",
    GameRoom
  );

  await server.listen(
    options.port,
    options.host
  );

  const address =
    server.transport.server
      ?.address() as
        AddressInfo | null;

  return {

    server,

    port:
      address?.port ??
      options.port,

    servesClient,

    close: async () => {

      // `false`: don't process.exit().
      await server.gracefullyShutdown(
        false
      );
    }
  };
}
