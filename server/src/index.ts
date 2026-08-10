import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";

const gameServer =
  new Server({
    transport:
      new WebSocketTransport()
  });

gameServer.define(
  "game",
  GameRoom
);

gameServer.listen(2567);

console.log(
  "Game server running on ws://localhost:2567"
);