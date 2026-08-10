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

    // --------------------------------------
    // PLAYER MOVEMENT
    // --------------------------------------

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

        player.x = message.x;
        player.y = message.y;

        this.broadcast(
          "playerMoved",
          player,
          {
            except: client
          }
        );
      }
    );

    // --------------------------------------
    // READY
    // --------------------------------------

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

        this.broadcast(
          "playerReadyChanged",
          {
            id: player.id,
            ready: player.ready
          }
        );
      }
    );
  }

  // ========================================
  // GENERATE ROOM CODE
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
      GameRoom.roomsByCode.has(code)
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
    // FIND AVAILABLE PLAYER SLOT
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
    // SPAWN POSITION
    // --------------------------------------

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

    // --------------------------------------
    // PLAYER COLOR
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
    // TELL OTHER PLAYERS
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

    this.broadcast(
      "playerLeft",
      {
        id:
          client.sessionId
      }
    );
  }

  // ========================================
  // ROOM DISPOSED
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