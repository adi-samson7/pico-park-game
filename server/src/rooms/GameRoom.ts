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

  // ----------------------------------------
  // ROOM CREATED
  // ----------------------------------------

  onCreate() {

    console.log(
      "Game room created:",
      this.roomId
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
    // PLAYER READY
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

        // Toggle ready status
        player.ready = !player.ready;

        console.log(
          `Player ${
            player.playerIndex + 1
          } ready: ${
            player.ready
          }`
        );

        // Tell every player about
        // the readiness change
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

  // ----------------------------------------
  // PLAYER JOINED
  // ----------------------------------------

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
    // GET SPAWN POSITION
    // --------------------------------------

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

    // --------------------------------------
    // GET PLAYER COLOR
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
    // TELL OTHER PLAYERS
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

  // ----------------------------------------
  // PLAYER LEFT
  // ----------------------------------------

  onLeave(client: Client) {

    console.log(
      "Player left:",
      client.sessionId
    );

    const player =
      this.players.get(
        client.sessionId
      );

    // Remove player
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
  }
}