import { Room, Client } from "colyseus";

import {
  registerRoom,
  findRoom,
  removeRoom
} from "../roomRegistry.js";

// ==========================================
// PLAYER DATA
// ==========================================

interface Player {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
  ready: boolean;
}

// ==========================================
// GAME ROOM
// ==========================================

export class GameRoom extends Room {

  maxClients = 4;

  players:
    Map<string, Player> =
    new Map();

  roomCode: string = "";

  // ========================================
  // SPAWN POSITIONS
  // ========================================

  private spawnPositions = [
    { x: 250, y: 300 },
    { x: 350, y: 300 },
    { x: 450, y: 300 },
    { x: 550, y: 300 }
  ];

  // ========================================
  // PLAYER COLORS
  // ========================================

  private playerColors = [
    0xff4444, // P1 - Red
    0x4488ff, // P2 - Blue
    0x44cc66, // P3 - Green
    0xffcc33  // P4 - Yellow
  ];

  // ========================================
  // GENERATE ROOM CODE
  // ========================================

  private generateRoomCode(): string {

    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

      code +=
        characters[
          Math.floor(
            Math.random() *
            characters.length
          )
        ];
    }

    return code;
  }

  // ========================================
  // ROOM CREATED
  // ========================================

  onCreate() {

    console.log(
      "Game room created:",
      this.roomId
    );

    // --------------------------------------
    // Generate 6-character code
    // --------------------------------------

    this.roomCode =
      this.generateRoomCode();

    console.log(
      "Room code:",
      this.roomCode
    );

    // --------------------------------------
    // Register code -> room ID
    // --------------------------------------

    registerRoom(
      this.roomCode,
      this.roomId
    );

    // ======================================
    // MOVE
    // ======================================

    this.onMessage(
      "move",
      (
        client,
        message
      ) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        // Basic validation
        if (
          typeof message?.x !== "number" ||
          typeof message?.y !== "number"
        ) {
          return;
        }

        player.x =
          message.x;

        player.y =
          message.y;

        // Send movement to everyone
        // except the player who moved.

        this.broadcast(
          "playerMoved",
          player,
          {
            except: client
          }
        );
      }
    );

    // ======================================
    // TOGGLE READY
    // ======================================

    this.onMessage(
      "toggleReady",
      (client) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        player.ready =
          !player.ready;

        console.log(
          `Player ${
            player.playerIndex + 1
          } ready: ${
            player.ready
          }`
        );

        // Tell everyone
        this.broadcast(
          "playerReadyChanged",
          {
            id: player.id,
            ready: player.ready
          }
        );

        this.checkAllReady();
      }
    );

    // ======================================
    // GET ROOM CODE
    // ======================================

    this.onMessage(
      "getRoomCode",
      (client) => {

        client.send(
          "roomCode",
          {
            roomCode:
              this.roomCode
          }
        );
      }
    );

    // ======================================
    // FIND ROOM BY CODE
    // ======================================

    this.onMessage(
      "findRoom",
      (client, message) => {

        const roomCode =
          String(
            message?.roomCode || ""
          )
            .trim()
            .toUpperCase();

        console.log(
          "Room lookup requested:",
          roomCode
        );

        const roomId =
          findRoom(roomCode);

        if (!roomId) {

          client.send(
            "roomNotFound"
          );

          return;
        }

        client.send(
          "roomFound",
          {
            roomId
          }
        );
      }
    );

    // ======================================
    // START GAME
    // ======================================

    this.onMessage(
      "startGame",
      (client) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        // Only P1 can start
        if (
          player.playerIndex !== 0
        ) {

          console.log(
            "Non-host attempted to start game."
          );

          return;
        }

        // Everyone must be ready
        if (
          !this.areAllPlayersReady()
        ) {

          console.log(
            "Cannot start: not everyone is ready."
          );

          return;
        }

        console.log(
          "Starting game..."
        );

        this.broadcast(
          "gameStarted"
        );
      }
    );
  }

  // ========================================
  // CHECK ALL PLAYERS READY
  // ========================================

  private areAllPlayersReady():
    boolean {

    if (
      this.players.size === 0
    ) {
      return false;
    }

    for (
      const player
      of this.players.values()
    ) {

      if (!player.ready) {
        return false;
      }
    }

    return true;
  }

  // ========================================
  // BROADCAST READY STATUS
  // ========================================

  private checkAllReady() {

    const allReady =
      this.areAllPlayersReady();

    this.broadcast(
      "allPlayersReady",
      {
        allReady
      }
    );
  }

  // ========================================
  // PLAYER JOINED
  // ========================================

  onJoin(
    client: Client
  ) {

    console.log(
      "Player joined:",
      client.sessionId
    );

    // --------------------------------------
    // Find free player index
    // --------------------------------------

    const usedIndexes =
      new Set(
        Array.from(
          this.players.values()
        ).map(
          player =>
            player.playerIndex
        )
      );

    let playerIndex = 0;

    while (
      usedIndexes.has(
        playerIndex
      )
    ) {

      playerIndex++;
    }

    // --------------------------------------
    // Get spawn position
    // --------------------------------------

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

    // --------------------------------------
    // Get player color
    // --------------------------------------

    const color =
      this.playerColors[
        playerIndex
      ];

    // --------------------------------------
    // Create player
    // --------------------------------------

    const player: Player = {

      id:
        client.sessionId,

      x:
        spawn.x,

      y:
        spawn.y,

      playerIndex,

      color,

      ready:
        false
    };

    // --------------------------------------
    // Store player
    // --------------------------------------

    this.players.set(
      client.sessionId,
      player
    );

    // --------------------------------------
    // Send own player information
    // --------------------------------------

    client.send(
      "playerJoinedSelf",
      player
    );

    // --------------------------------------
    // Send room code
    // --------------------------------------

    client.send(
      "roomCode",
      {
        roomCode:
          this.roomCode
      }
    );

    console.log(
      `Player ${
        playerIndex + 1
      } joined at (${
        spawn.x
      }, ${
        spawn.y
      })`
    );

    // ======================================
    // SEND EXISTING PLAYERS
    // ======================================

    for (
      const existingPlayer
      of this.players.values()
    ) {

      if (
        existingPlayer.id !==
        client.sessionId
      ) {

        client.send(
          "playerJoined",
          existingPlayer
        );
      }
    }

    // ======================================
    // TELL OTHER PLAYERS
    // ======================================

    this.broadcast(
      "playerJoined",
      player,
      {
        except: client
      }
    );

    // ======================================
    // SEND READY STATES
    // ======================================

    for (
      const existingPlayer
      of this.players.values()
    ) {

      client.send(
        "playerReadyChanged",
        {
          id:
            existingPlayer.id,

          ready:
            existingPlayer.ready
        }
      );
    }

    // ======================================
    // SEND CURRENT ROOM STATE
    // ======================================

    this.checkAllReady();
  }

  // ========================================
  // PLAYER LEFT
  // ========================================

  onLeave(
    client: Client
  ) {

    console.log(
      "Player left:",
      client.sessionId
    );

    const player =
      this.players.get(
        client.sessionId
      );

    this.players.delete(
      client.sessionId
    );

    if (player) {

      console.log(
        `Player ${
          player.playerIndex + 1
        } left the room`
      );
    }

    // Tell remaining players
    this.broadcast(
      "playerLeft",
      {
        id:
          client.sessionId
      }
    );

    this.checkAllReady();
  }

  // ========================================
  // ROOM DISPOSED
  // ========================================

  onDispose() {

    console.log(
      "Disposing room:",
      this.roomId
    );

    if (this.roomCode) {

      removeRoom(
        this.roomCode
      );
    }
  }
}