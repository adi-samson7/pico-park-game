import { Room, Client } from "colyseus";

interface Player {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
  ready: boolean;
}

export class GameRoom extends Room {

  maxClients = 4;

  players: Map<string, Player> = new Map();

  // ----------------------------------------
  // ROOM STATE
  // ----------------------------------------

  private gameStarted = false;

  // ----------------------------------------
  // ROOM CODE
  // ----------------------------------------

  roomCode = "";

  static roomsByCode:
    Map<string, GameRoom> =
    new Map();

  // ----------------------------------------
  // SPAWN POSITIONS
  // ----------------------------------------

  private spawnPositions = [
    { x: 250, y: 300 },
    { x: 350, y: 300 },
    { x: 450, y: 300 },
    { x: 550, y: 300 }
  ];

  // ----------------------------------------
  // PLAYER COLORS
  // ----------------------------------------

  private playerColors = [
    0xff4444, // Red
    0x4488ff, // Blue
    0x44cc66, // Green
    0xffcc33  // Yellow
  ];

  // ========================================
  // ROOM CREATED
  // ========================================

  onCreate() {

    console.log(
      "Game room created:",
      this.roomId
    );

    // --------------------------------------
    // GENERATE ROOM CODE
    // --------------------------------------

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
    // PLAYER MOVEMENT
    // ======================================

    this.onMessage(
      "move",
      (client, message) => {

        // Don't accept movement
        // before a player exists.

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        // ----------------------------------
        // UPDATE PLAYER POSITION
        // ----------------------------------

        player.x =
          Number(message.x);

        player.y =
          Number(message.y);

        // ----------------------------------
        // BROADCAST TO OTHER PLAYERS
        // ----------------------------------

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

        // Don't allow players to change
        // ready state after the game starts.

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

        // Toggle ready state.

        player.ready =
          !player.ready;

        console.log(
          `Player ${
            player.playerIndex + 1
          } ready: ${
            player.ready
          }`
        );

        // ----------------------------------
        // INFORM ALL PLAYERS
        // ----------------------------------

        this.broadcast(
          "playerReadyChanged",
          {
            id:
              player.id,

            ready:
              player.ready
          }
        );

        // ----------------------------------
        // CHECK IF GAME CAN START
        // ----------------------------------

        this.checkAllPlayersReady();
      }
    );
  }

  // ========================================
  // GENERATE ROOM CODE
  // ========================================

  private generateRoomCode(): string {

    // Avoid confusing characters:
    // I, O, 0 and 1.

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
  // CHECK ALL PLAYERS READY
  // ========================================

  private checkAllPlayersReady() {

    const playerList =
      Array.from(
        this.players.values()
      );

    // --------------------------------------
    // REQUIRE AT LEAST ONE PLAYER
    // --------------------------------------
    //
    // We are keeping this at 1 temporarily
    // so we can easily test the game.
    //
    // Later we can change this to:
    //
    // if (playerList.length < 2)
    //
    // --------------------------------------

    if (
      playerList.length === 0
    ) {
      return;
    }

    // --------------------------------------
    // CHECK EVERY PLAYER
    // --------------------------------------

    const everyoneReady =
      playerList.every(
        player =>
          player.ready
      );

    if (!everyoneReady) {
      return;
    }

    console.log(
      "All players are ready!"
    );

    this.startGame();
  }

  // ========================================
  // START GAME
  // ========================================

  private startGame() {

    // Prevent starting twice.

    if (this.gameStarted) {
      return;
    }

    this.gameStarted =
      true;

    console.log(
      "Starting game:",
      this.roomCode
    );

    // --------------------------------------
    // TELL ALL CLIENTS
    // --------------------------------------

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
  // PLAYER JOINED
  // ========================================

  onJoin(client: Client) {

    console.log(
      "Player joined:",
      client.sessionId
    );

    // --------------------------------------
    // FIND AVAILABLE PLAYER INDEX
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

    // Safety check.

    if (
      playerIndex >=
      this.spawnPositions.length
    ) {

      throw new Error(
        "No available player slot."
      );
    }

    // --------------------------------------
    // GET SPAWN
    // --------------------------------------

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

    // --------------------------------------
    // GET COLOR
    // --------------------------------------

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

      playerIndex:
        playerIndex,

      color:
        color,

      ready:
        false
    };

    // --------------------------------------
    // STORE PLAYER
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
    // SEND OWN PLAYER DATA
    // --------------------------------------

    client.send(
      "playerJoinedSelf",
      player
    );

    // --------------------------------------
    // SEND ROOM INFORMATION
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
    // TO NEW PLAYER
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
    // INFORM OTHER PLAYERS
    // ABOUT NEW PLAYER
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

    const player =
      this.players.get(
        client.sessionId
      );

    // Remove player.

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

    // --------------------------------------
    // INFORM OTHER PLAYERS
    // --------------------------------------

    this.broadcast(
      "playerLeft",
      {
        id:
          client.sessionId
      }
    );

    // --------------------------------------
    // CHECK READY STATE AGAIN
    // --------------------------------------

    if (
      !this.gameStarted
    ) {

      this.checkAllPlayersReady();
    }
  }

  // ========================================
  // ROOM DISPOSED
  // ========================================

  onDispose() {

    console.log(
      "Disposing room:",
      this.roomId
    );

    // Remove room code mapping.

    GameRoom.roomsByCode.delete(
      this.roomCode
    );
  }
}