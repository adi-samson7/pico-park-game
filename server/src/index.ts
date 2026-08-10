import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";

import { GameRoom } from "./rooms/GameRoom.js";

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

      // ------------------------------------
      // CORS
      // ------------------------------------

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

      // ------------------------------------
      // OPTIONS
      // ------------------------------------

      if (
        req.method === "OPTIONS"
      ) {

        res.writeHead(204);

        res.end();

        return;
      }

      // ------------------------------------
      // ONLY GET REQUESTS
      // ------------------------------------

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

      // ------------------------------------
      // ROOM LOOKUP
      // ------------------------------------

      const match =
        req.url?.match(
          /^\/room\/([A-Za-z0-9]+)$/
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
              "Endpoint not found"
          })
        );

        return;
      }

      const roomCode =
        match[1]
          .toUpperCase();

      // ------------------------------------
      // FIND ROOM
      // ------------------------------------

      const room =
        GameRoom.roomsByCode.get(
          roomCode
        );

      if (!room) {

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

      // ------------------------------------
      // CHECK ROOM CAPACITY
      // ------------------------------------

      if (
        room.clients.length >=
        room.maxClients
      ) {

        res.writeHead(
          409,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Room is full"
          })
        );

        return;
      }

      // ------------------------------------
      // RETURN ROOM INFORMATION
      // ------------------------------------

      res.writeHead(
        200,
        {
          "Content-Type":
            "application/json"
        }
      );

      res.end(
        JSON.stringify({
          roomId:
            room.roomId,

          roomCode:
            room.roomCode
        })
      );
    }
  );

// ==========================================
// START SERVERS
// ==========================================

await gameServer.listen(
  2567
);

lookupServer.listen(
  3000,
  () => {

    console.log(
      "Room lookup server running on http://localhost:3000"
    );

    console.log(
      "Game server running on ws://localhost:2567"
    );
  }
);