import { Room, Client } from "colyseus";

interface Player {
  id: string;

  x: number;
  y: number;

  velocityX: number;
  velocityY: number;

  left: boolean;
  right: boolean;

  playerIndex: number;
  color: number;
  ready: boolean;
}

export class GameRoom extends Room {

  maxClients = 4;

  players: Map<string, Player> = new Map();

  private gameStarted = false;

  roomCode = "";

  static roomsByCode:
    Map<string, GameRoom> = new Map();

  // ========================================
  // PHYSICS
  // ========================================

  private readonly GRAVITY = 1200;
  private readonly MOVE_SPEED = 250;
  private readonly JUMP_SPEED = -500;

  // Phaser player is 40x60.
  // Ground top = 525.
  // Player center = 495.

  private readonly GROUND_Y = 495;

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
  // COLORS
  // ========================================

  private playerColors = [
    0xff4444,
    0x4488ff,
    0x44cc66,
    0xffcc33
  ];

  // ========================================
  // CREATE
  // ========================================

  onCreate() {

    console.log(
      "Game room created:",
      this.roomId
    );

    // Generate room code

    this.roomCode =
      this.generateRoomCode();

    GameRoom.roomsByCode.set(
      this.roomCode,
      this
    );

    console.log(
      "Room code:",
      this.roomCode
    );

    // ======================================
    // SERVER GAME LOOP
    // ======================================

    this.setSimulationInterval(
      (deltaTime) => {

        if (!this.gameStarted) {
          return;
        }

        this.updatePhysics(
          deltaTime
        );
      },
      1000 / 60
    );

    // ======================================
    // PLAYER INPUT
    // ======================================

    this.onMessage(
      "input",
      (client, message) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        // Store keyboard state.

        player.left =
          Boolean(message?.left);

        player.right =
          Boolean(message?.right);

        // Jump is handled as an event.

        if (
          Boolean(message?.jump)
        ) {

          const onGround =
            player.y >=
            this.GROUND_Y - 1;

          if (onGround) {

            player.velocityY =
              this.JUMP_SPEED;
          }
        }
      }
    );

    // ======================================
    // READY
    // ======================================

    this.onMessage(
      "toggleReady",
      (client) => {

        if (this.gameStarted) {
          return;
        }

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

        this.broadcast(
          "playerReadyChanged",
          {
            id:
              player.id,

            ready:
              player.ready
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

        if (this.gameStarted) {
          return;
        }

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        // Only Player 1 / host.

        if (
          player.playerIndex !== 0
        ) {

          client.send(
            "startGameError",
            {
              message:
                "Only the host can start the game."
            }
          );

          return;
        }

        // At least two players.

        if (
          this.players.size < 2
        ) {

          client.send(
            "startGameError",
            {
              message:
                "At least 2 players are required."
            }
          );

          return;
        }

        // Everyone must be ready.

        const everyoneReady =
          Array.from(
            this.players.values()
          ).every(
            player =>
              player.ready
          );

        if (!everyoneReady) {

          client.send(
            "startGameError",
            {
              message:
                "Everyone must be ready."
            }
          );

          return;
        }

        this.startGame();
      }
    );
  }

  // ========================================
  // PHYSICS UPDATE
  // ========================================

  private updatePhysics(
    deltaTime: number
  ) {

    const delta =
      deltaTime / 1000;

    for (
      const player
      of this.players.values()
    ) {

      // ------------------------------------
      // HORIZONTAL MOVEMENT
      // ------------------------------------

      if (
        player.left &&
        !player.right
      ) {

        player.velocityX =
          -this.MOVE_SPEED;

      } else if (
        player.right &&
        !player.left
      ) {

        player.velocityX =
          this.MOVE_SPEED;

      } else {

        player.velocityX = 0;
      }

      // ------------------------------------
      // GRAVITY
      // ------------------------------------

      player.velocityY +=
        this.GRAVITY *
        delta;

      // ------------------------------------
      // POSITION
      // ------------------------------------

      player.x +=
        player.velocityX *
        delta;

      player.y +=
        player.velocityY *
        delta;

      // ------------------------------------
      // GROUND COLLISION
      // ------------------------------------

      if (
        player.y >=
        this.GROUND_Y
      ) {

        player.y =
          this.GROUND_Y;

        player.velocityY = 0;
      }

      // ------------------------------------
      // WORLD BOUNDS
      // ------------------------------------

      if (player.x < 20) {
        player.x = 20;
      }

      if (player.x > 780) {
        player.x = 780;
      }

      // ------------------------------------
      // BROADCAST POSITION
      // ------------------------------------

      this.broadcast(
        "playerMoved",
        {
          id:
            player.id,

          x:
            player.x,

          y:
            player.y
        }
      );
    }
  }

  // ========================================
  // START GAME
  // ========================================

  private startGame() {

    if (this.gameStarted) {
      return;
    }

    this.gameStarted = true;

    console.log(
      "Starting game:",
      this.roomCode
    );

    this.broadcast(
      "gameStarted",
      {
        roomId:
          this.roomId,

        roomCode:
          this.roomCode
      }
    );
  }

  // ========================================
  // ROOM CODE
  // ========================================

  private generateRoomCode(): string {

    const characters =
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    do {

      code = "";

      for (
        let i = 0;
        i < 6;
        i++
      ) {

        const index =
          Math.floor(
            Math.random() *
            characters.length
          );

        code +=
          characters[index];
      }

    } while (
      GameRoom.roomsByCode.has(
        code
      )
    );

    return code;
  }

  // ========================================
  // PLAYER JOINED
  // ========================================

  onJoin(client: Client) {

    console.log(
      "Player joined:",
      client.sessionId
    );

    // --------------------------------------
    // FIND AVAILABLE SLOT
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

    if (
      playerIndex >=
      this.spawnPositions.length
    ) {

      throw new Error(
        "No available player slot."
      );
    }

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

    const color =
      this.playerColors[
        playerIndex
      ];

    // --------------------------------------
    // CREATE PLAYER
    // --------------------------------------

    const player: Player = {

      id:
        client.sessionId,

      x:
        spawn.x,

      y:
        spawn.y,

      velocityX:
        0,

      velocityY:
        0,

      left:
        false,

      right:
        false,

      playerIndex:
        playerIndex,

      color:
        color,

      ready:
        false
    };

    // --------------------------------------
    // STORE
    // --------------------------------------

    this.players.set(
      client.sessionId,
      player
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

    // --------------------------------------
    // SEND OWN DATA
    // --------------------------------------

    client.send(
      "playerJoinedSelf",
      player
    );

    // --------------------------------------
    // ROOM INFO
    // --------------------------------------

    client.send(
      "roomInfo",
      {
        roomId:
          this.roomId,

        roomCode:
          this.roomCode
      }
    );

    // --------------------------------------
    // SEND EXISTING PLAYERS
    // --------------------------------------

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

    // --------------------------------------
    // INFORM OTHER CLIENTS
    // --------------------------------------

    this.broadcast(
      "playerJoined",
      player,
      {
        except: client
      }
    );
  }

  // ========================================
  // PLAYER LEFT
  // ========================================

  onLeave(client: Client) {

    console.log(
      "Player left:",
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
  }

  // ========================================
  // DISPOSE
  // ========================================

  onDispose() {

    console.log(
      "Disposing room:",
      this.roomId
    );

    GameRoom.roomsByCode.delete(
      this.roomCode
    );
  }
}