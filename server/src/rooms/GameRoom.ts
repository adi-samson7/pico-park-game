import { Room, Client } from "colyseus";

interface Player {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
}

export class GameRoom extends Room {
  maxClients = 4;

  players: Map<string, Player> = new Map();

  // Spawn positions for up to 4 players
  private spawnPositions = [
    { x: 250, y: 300 },
    { x: 350, y: 300 },
    { x: 450, y: 300 },
    { x: 550, y: 300 }
  ];

  // Player colors
  private playerColors = [
    0xff4444, // Red
    0x4488ff, // Blue
    0x44cc66, // Green
    0xffcc33  // Yellow
  ];

  onCreate() {
    console.log("Game room created:", this.roomId);

    this.onMessage("move", (client, message) => {
      const player = this.players.get(client.sessionId);

      if (!player) {
        return;
      }

      player.x = message.x;
      player.y = message.y;

      this.broadcast("playerMoved", player, {
        except: client
      });
    });
  }

  onJoin(client: Client) {
    console.log("Player joined:", client.sessionId);

    // Find the first available player slot
    const usedIndexes = new Set(
      Array.from(this.players.values()).map(
        player => player.playerIndex
      )
    );

    let playerIndex = 0;

    while (usedIndexes.has(playerIndex)) {
      playerIndex++;
    }

    // Get spawn position
    const spawn = this.spawnPositions[playerIndex];

    // Get player color
    const color = this.playerColors[playerIndex];

    const player: Player = {
      id: client.sessionId,
      x: spawn.x,
      y: spawn.y,
      playerIndex: playerIndex,
      color: color
    };

    // Add player to room
    this.players.set(client.sessionId, player);

    console.log(
      `Player ${playerIndex + 1} joined at (${spawn.x}, ${spawn.y})`
    );

    // Send existing players to the new player
    for (const existingPlayer of this.players.values()) {
      if (existingPlayer.id !== client.sessionId) {
        client.send("playerJoined", existingPlayer);
      }
    }

    // Tell all other players about the new player
    this.broadcast(
      "playerJoined",
      player,
      {
        except: client
      }
    );
  }

  onLeave(client: Client) {
    console.log("Player left:", client.sessionId);

    const player = this.players.get(client.sessionId);

    this.players.delete(client.sessionId);

    if (player) {
      console.log(
        `Player ${player.playerIndex + 1} left the room`
      );
    }

    // Tell remaining players
    this.broadcast("playerLeft", {
      id: client.sessionId
    });
  }
}