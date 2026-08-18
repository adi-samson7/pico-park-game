import { Room, Client } from "colyseus";
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

  // Server-side movement state
  velocityX: number;
  velocityY: number;

  left: boolean;
  right: boolean;
  jump: boolean;
}

export class GameRoom extends Room {

  maxClients = 4;

  players:
    Map<string, Player> =
    new Map();

  roomCode: string = "";

  private spawnPositions = [
    { x: 250, y: 300 },
    { x: 350, y: 300 },
    { x: 450, y: 300 },
    { x: 550, y: 300 }
  ];

  private playerColors = [
    0xff4444,
    0x4488ff,
    0x44cc66,
    0xffcc33
  ];

  // ==========================================
  // SERVER PHYSICS
  // ==========================================

  private readonly moveSpeed = 200;

  private readonly jumpVelocity = -450;

  private readonly gravity = 1000;

  private readonly groundY = 520;

  private readonly playerWidth = 40;

  private readonly playerHeight = 60;

  // ==========================================
  // ROOM CREATED
  // ==========================================

  onCreate() {

    console.log(
      "Game room created:",
      this.roomId
    );

    // ----------------------------------------
    // GENERATE ROOM CODE
    // ----------------------------------------

    this.roomCode =
      this.generateRoomCode();

    console.log(
      "Room code:",
      this.roomCode
    );

    // ----------------------------------------
    // REGISTER ROOM
    // ----------------------------------------

    registerRoom(
      this.roomCode,
      this.roomId
    );

    // ========================================
    // PLAYER INPUT
    // ========================================

    this.onMessage(
      "input",
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

        // ------------------------------------
        // ONLY ACCEPT VALID INPUT
        // ------------------------------------

        player.left =
          message.left === true;

        player.right =
          message.right === true;

        // ------------------------------------
        // JUMP
        // ------------------------------------

        if (
          message.jump === true
        ) {

          player.jump = true;

        }
      }
    );

    // ========================================
    // TOGGLE READY
    // ========================================

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

    // ========================================
    // GET ROOM CODE
    // ========================================

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

    // ========================================
    // START GAME
    // ========================================

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

        // Host only
        if (
          player.playerIndex !== 0
        ) {

          return;

        }

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

    // ========================================
    // SERVER GAME LOOP
    // ========================================

    this.setSimulationInterval(
      (deltaTime) => {

        this.updatePlayers(
          deltaTime / 1000
        );

      },
      1000 / 60
    );
  }

  // ==========================================
  // GENERATE ROOM CODE
  // ==========================================

  private generateRoomCode(): string {

    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";

    for (
      let i = 0;
      i < 6;
      i++
    ) {

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

  // ==========================================
  // SERVER GAME LOOP
  // ==========================================

  private updatePlayers(
    deltaTime: number
  ) {

    for (
      const player
      of this.players.values()
    ) {

      // --------------------------------------
      // HORIZONTAL MOVEMENT
      // --------------------------------------

      if (player.left) {

        player.velocityX =
          -this.moveSpeed;

      }

      else if (player.right) {

        player.velocityX =
          this.moveSpeed;

      }

      else {

        player.velocityX = 0;

      }

      // --------------------------------------
      // JUMP
      // --------------------------------------

      const onGround =
        player.y >=
        this.groundY -
        this.playerHeight / 2;

      if (
        player.jump &&
        onGround
      ) {

        player.velocityY =
          this.jumpVelocity;

      }

      player.jump = false;

      // --------------------------------------
      // GRAVITY
      // --------------------------------------

      player.velocityY +=
        this.gravity *
        deltaTime;

      // --------------------------------------
      // UPDATE POSITION
      // --------------------------------------

      player.x +=
        player.velocityX *
        deltaTime;

      player.y +=
        player.velocityY *
        deltaTime;

      // --------------------------------------
      // GROUND COLLISION
      // --------------------------------------

      const floorY =
        this.groundY -
        this.playerHeight / 2;

      if (
        player.y >= floorY
      ) {

        player.y =
          floorY;

        player.velocityY = 0;

      }

      // --------------------------------------
      // WORLD BOUNDS
      // --------------------------------------

      const halfWidth =
        this.playerWidth / 2;

      const minX =
        halfWidth;

      const maxX =
        800 -
        halfWidth;

      if (
        player.x < minX
      ) {

        player.x =
          minX;

      }

      if (
        player.x > maxX
      ) {

        player.x =
          maxX;

      }

      // --------------------------------------
      // BROADCAST AUTHORITATIVE POSITION
      // --------------------------------------

      this.broadcast(
        "playerMoved",
        {
          id: player.id,
          x: player.x,
          y: player.y
        }
      );
    }
  }

  // ==========================================
  // CHECK READY
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

  private checkAllReady() {

    this.broadcast(
      "allPlayersReady",
      {
        allReady:
          this.areAllPlayersReady()
      }
    );
  }

  // ==========================================
  // PLAYER JOINED
  // ==========================================

  onJoin(
    client: Client
  ) {

    console.log(
      "Player joined:",
      client.sessionId
    );

    // ----------------------------------------
    // FIND FREE INDEX
    // ----------------------------------------

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

    // ----------------------------------------
    // SPAWN
    // ----------------------------------------

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
        false,

      velocityX:
        0,

      velocityY:
        0,

      left:
        false,

      right:
        false,

      jump:
        false
    };

    this.players.set(
      client.sessionId,
      player
    );

    // ----------------------------------------
    // SEND OWN PLAYER DATA
    // ----------------------------------------

    client.send(
      "playerJoinedSelf",
      player
    );

    // ----------------------------------------
    // SEND ROOM CODE TO HOST
    // ----------------------------------------

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
    }

    // ----------------------------------------
    // SEND EXISTING PLAYERS
    // ----------------------------------------

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

    // ----------------------------------------
    // TELL OTHER PLAYERS
    // ----------------------------------------

    this.broadcast(
      "playerJoined",
      player,
      {
        except:
          client
      }
    );

    // ----------------------------------------
    // SEND READY STATES
    // ----------------------------------------

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

    this.checkAllReady();
  }

  // ==========================================
  // PLAYER LEFT
  // ==========================================

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

    this.broadcast(
      "playerLeft",
      {
        id:
          client.sessionId
      }
    );

    this.checkAllReady();

    // ----------------------------------------
    // REMOVE ROOM FROM REGISTRY
    // ----------------------------------------

    if (
      this.players.size === 0
    ) {

      removeRoom(
        this.roomCode
      );

    }
  }
}