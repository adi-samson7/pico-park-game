import { Client, Room } from "colyseus";

import {
  registerRoom,
  removeRoom
} from "../roomRegistry.js";

interface Player {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
  ready: boolean;
}

export class GameRoom extends Room {

  // ==========================================
  // ROOM SETTINGS
  // ==========================================

  maxClients = 4;

  players: Map<string, Player> = new Map();

  roomCode: string = "";

  // ==========================================
  // SPAWN POSITIONS
  // ==========================================

  private spawnPositions = [
    { x: 250, y: 300 },
    { x: 350, y: 300 },
    { x: 450, y: 300 },
    { x: 550, y: 300 }
  ];

  // ==========================================
  // PLAYER COLORS
  // ==========================================

  private playerColors = [
    0xff4444, // P1 - Red
    0x4488ff, // P2 - Blue
    0x44cc66, // P3 - Green
    0xffcc33  // P4 - Yellow
  ];

  // ==========================================
  // GENERATE 6 CHARACTER ROOM CODE
  // ==========================================

  private generateRoomCode(): string {

    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

      code +=
        characters[
          Math.floor(
            Math.random() * characters.length
          )
        ];
    }

    return code;
  }

  // ==========================================
  // CREATE ROOM
  // ==========================================

  onCreate() {

    console.log(
      "================================"
    );

    console.log(
      "GAME ROOM CREATED"
    );

    console.log(
      "Room ID:",
      this.roomId
    );

    // ------------------------------------------
    // GENERATE ROOM CODE
    // ------------------------------------------

    this.roomCode =
      this.generateRoomCode();

    console.log(
      "Room Code:",
      this.roomCode
    );

    // ------------------------------------------
    // REGISTER ROOM
    // ------------------------------------------

    registerRoom(
      this.roomCode,
      this.roomId
    );

    console.log(
      `Room registered: ${this.roomCode} -> ${this.roomId}`
    );

    console.log(
      "================================"
    );

    // ==========================================
    // MOVE
    // ==========================================

    this.onMessage(
      "move",
      (client, message) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        player.x =
          Number(message.x);

        player.y =
          Number(message.y);

        this.broadcast(
          "playerMoved",
          player,
          {
            except: client
          }
        );
      }
    );

    // ==========================================
    // TOGGLE READY
    // ==========================================

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
          `Player ${player.playerIndex + 1} ready: ${player.ready}`
        );

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

    // ==========================================
    // GET ROOM CODE
    // ==========================================

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

    // ==========================================
    // START GAME
    // ==========================================

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

        // --------------------------------------
        // ONLY HOST CAN START
        // --------------------------------------

        if (
          player.playerIndex !== 0
        ) {

          console.log(
            "Non-host tried to start game."
          );

          return;
        }

        // --------------------------------------
        // CHECK READY
        // --------------------------------------

        if (
          !this.areAllPlayersReady()
        ) {

          console.log(
            "Cannot start game - not everyone is ready."
          );

          return;
        }

        console.log(
          "================================"
        );

        console.log(
          "GAME STARTING"
        );

        console.log(
          "================================"
        );

        this.broadcast(
          "gameStarted"
        );
      }
    );
  }

  // ==========================================
  // CHECK ALL PLAYERS READY
  // ==========================================

  private areAllPlayersReady(): boolean {

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

  // ==========================================
  // BROADCAST READY STATE
  // ==========================================

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

  // ==========================================
  // PLAYER JOINED
  // ==========================================

  onJoin(client: Client) {

    console.log(
      "Player joined:",
      client.sessionId
    );

    // ------------------------------------------
    // FIND FREE PLAYER INDEX
    // ------------------------------------------

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

    // ------------------------------------------
    // SPAWN
    // ------------------------------------------

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

    const color =
      this.playerColors[
        playerIndex
      ];

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

    // ------------------------------------------
    // ADD PLAYER
    // ------------------------------------------

    this.players.set(
      client.sessionId,
      player
    );

    // ------------------------------------------
    // SEND OWN PLAYER DATA
    // ------------------------------------------

    client.send(
      "playerJoinedSelf",
      player
    );

    // ------------------------------------------
    // SEND ROOM CODE
    //
    // IMPORTANT:
    // Host receives the code here.
    // ------------------------------------------

    if (
      playerIndex === 0
    ) {

      client.send(
        "roomCode",
        {
          roomCode:
            this.roomCode
        }
      );

      console.log(
        "Sent room code to host:",
        this.roomCode
      );
    }

    // ------------------------------------------
    // SEND EXISTING PLAYERS TO NEW PLAYER
    // ------------------------------------------

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

    // ------------------------------------------
    // TELL OTHER PLAYERS ABOUT NEW PLAYER
    // ------------------------------------------

    this.broadcast(
      "playerJoined",
      player,
      {
        except:
          client
      }
    );

    // ------------------------------------------
    // SEND READY STATES
    // ------------------------------------------

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

    // ------------------------------------------
    // UPDATE READY STATE
    // ------------------------------------------

    this.checkAllReady();

    console.log(
      `Player ${playerIndex + 1} joined`
    );
  }

  // ==========================================
  // PLAYER LEFT
  // ==========================================

  onLeave(client: Client) {

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
        `Player ${player.playerIndex + 1} left the room`
      );
    }

    this.broadcast(
      "playerLeft",
      {
        id:
          client.sessionId
      }
    );

    this.checkAllReady();
  }

  // ==========================================
  // ROOM DISPOSED
  // ==========================================

  onDispose() {

    console.log(
      "Disposing room:",
      this.roomId
    );

    // ------------------------------------------
    // REMOVE ROOM FROM REGISTRY
    // ------------------------------------------

    if (
      this.roomCode
    ) {

      removeRoom(
        this.roomCode
      );

      console.log(
        `Removed room ${this.roomCode} from registry`
      );
    }
  }
}