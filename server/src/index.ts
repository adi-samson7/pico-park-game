import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";

import { GameRoom } from "./rooms/GameRoom.js";

import {
  findRoom
} from "./roomRegistry.js";

// ==========================================
// COLYSEUS SERVER
// ==========================================

const gameServer =
  new Server({
    transport:
      new WebSocketTransport()
  });

// ==========================================
// REGISTER GAME ROOM
// ==========================================

gameServer.define(
  "game",
  GameRoom
);

// ==========================================
// ROOM LOOKUP HTTP SERVER
// ==========================================

const lookupServer =
  createServer(
    (req, res) => {

      // ======================================
      // CORS
      // ======================================

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      // ======================================
      // OPTIONS
      // ======================================

      if (
        req.method === "OPTIONS"
      ) {

        res.writeHead(
          204
        );

        res.end();

        return;
      }

      // ======================================
      // ONLY GET
      // ======================================

      if (
        req.method !== "GET"
      ) {

        res.writeHead(
          405,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Method not allowed"
          })
        );

        return;
      }

      // ======================================
      // MATCH ROOM CODE
      // ======================================

      const match =
        req.url?.match(
          /^\/room\/([A-Za-z0-9]{6})$/
        );

      if (!match) {

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Invalid room code."
          })
        );

        return;
      }

      const roomCode =
        match[1]
          .toUpperCase();

      console.log(
        `[Lookup] Searching for room: ${roomCode}`
      );

      // ======================================
      // FIND ROOM IN REGISTRY
      // ======================================

      const roomId =
        findRoom(
          roomCode
        );

      if (!roomId) {

        console.log(
          `[Lookup] Room not found: ${roomCode}`
        );

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Room not found"
          })
        );

        return;
      }

      // ======================================
      // RETURN ROOM
      // ======================================

      console.log(
        `[Lookup] Room found: ${roomCode} -> ${roomId}`
      );

      res.writeHead(
        200,
        {
          "Content-Type":
            "application/json"
        }
      );

      res.end(
        JSON.stringify({

          roomId,

          roomCode
        })
      );
    }
  );

// ==========================================
// START COLYSEUS SERVER
// ==========================================

await gameServer.listen(
  2567
);

// ==========================================
// START LOOKUP SERVER
// ==========================================

lookupServer.listen(
  3000,
  () => {

    console.log(
      "================================"
    );

    console.log(
      "PICO CO-OP SERVERS RUNNING"
    );

    console.log(
      "Game server: ws://localhost:2567"
    );

    console.log(
      "Lookup server: http://localhost:3000"
    );

    console.log(
      "================================"
    );
  }
);