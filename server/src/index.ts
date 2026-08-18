import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";

import { GameRoom } from "./rooms/GameRoom.js";
import { findRoom } from "./roomRegistry.js";

// ==========================================
// COLYSEUS SERVER
// ==========================================

const gameServer = new Server({
  transport: new WebSocketTransport()
});

gameServer.define("game", GameRoom);

// ==========================================
// ROOM LOOKUP HTTP SERVER
// ==========================================

const lookupServer = createServer((req, res) => {

  // CORS
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

  // OPTIONS
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only GET
  if (req.method !== "GET") {
    res.writeHead(405, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        error: "Method not allowed"
      })
    );

    return;
  }

  // ========================================
  // /room/ABC123
  // ========================================

  const match =
    req.url?.match(
      /^\/room\/([A-Za-z0-9]{6})$/
    );

  if (!match) {
    res.writeHead(404, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        error: "Room not found"
      })
    );

    return;
  }

  const roomCode =
    match[1].toUpperCase();

  const roomId =
    findRoom(roomCode);

  // ========================================
  // ROOM DOES NOT EXIST
  // ========================================

  if (!roomId) {
    res.writeHead(404, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        error: "Room not found"
      })
    );

    return;
  }

  // ========================================
  // ROOM FOUND
  // ========================================

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(
    JSON.stringify({
      roomId,
      roomCode
    })
  );
});

// ==========================================
// START SERVERS
// ==========================================

await gameServer.listen(2567);

lookupServer.listen(
  3000,
  () => {
    console.log(
      "Game server running on ws://localhost:2567"
    );

    console.log(
      "Room lookup running on http://localhost:3000"
    );
  }
);