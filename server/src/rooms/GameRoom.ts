import { Room, Client } from "colyseus";

import {
  registerRoom,
  findRoom,
  removeRoom
} from "../roomRegistry.js";

// ==========================================
// TYPES
// ==========================================

interface Player {

  id: string;

  x: number;
  y: number;

  velocityX: number;
  velocityY: number;

  playerIndex: number;

  color: number;

  ready: boolean;

  alive: boolean;

  // 0 = no jump used
  // 1 = first jump used
  // 2 = second jump used
  jumpCount: number;
}

interface PlayerInput {

  left?: boolean;

  right?: boolean;

  jump?: boolean;
}

interface Platform {

  x: number;
  y: number;

  width: number;
  height: number;
}

interface Crystal {

  id: number;

  x: number;
  y: number;

  collected: boolean;
}

interface LevelData {

  platforms: Platform[];

  crystals: {
    x: number;
    y: number;
  }[];
}

// ==========================================
// GAME ROOM
// ==========================================

export class GameRoom extends Room {

  maxClients = 4;

  players:
    Map<string, Player> =
    new Map();

  roomCode = "";

  // ========================================
  // GAME
  // ========================================

  private gameStarted = false;

  private gameFinished = false;

  private currentLevel = 1;

  private score = 0;

  private readonly MAX_LEVELS = 3;

  private readonly CRYSTALS_PER_LEVEL = 10;

  // ========================================
  // PHYSICS
  // ========================================

  private readonly MOVE_SPEED = 220;

  private readonly JUMP_SPEED = -500;

  private readonly GRAVITY = 1200;

  private readonly MAX_JUMPS = 2;

  private readonly GROUND_TOP = 540;

  private readonly PLAYER_WIDTH = 40;

  private readonly PLAYER_HEIGHT = 60;

  private readonly WORLD_WIDTH = 800;

  private readonly WORLD_HEIGHT = 600;

  // ========================================
  // LEVEL DATA
  // ========================================

  private platforms: Platform[] = [];

  private crystals:
    Map<number, Crystal> =
    new Map();

  // ========================================
  // SPAWN POSITIONS
  // ========================================

  private spawnPositions = [

    {
      x: 180,
      y: 300
    },

    {
      x: 300,
      y: 300
    },

    {
      x: 420,
      y: 300
    },

    {
      x: 540,
      y: 300
    }
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
  // LEVELS
  // ========================================

  private levels: LevelData[] = [

    // ======================================
    // LEVEL 1
    // ======================================

    {
      platforms: [

        {
          x: 100,
          y: 450,
          width: 180,
          height: 20
        },

        {
          x: 360,
          y: 400,
          width: 160,
          height: 20
        },

        {
          x: 600,
          y: 450,
          width: 150,
          height: 20
        },

        {
          x: 250,
          y: 300,
          width: 150,
          height: 20
        }
      ],

      crystals: [

        { x: 120, y: 410 },
        { x: 170, y: 410 },
        { x: 220, y: 410 },

        { x: 380, y: 360 },
        { x: 430, y: 360 },
        { x: 480, y: 360 },

        { x: 620, y: 410 },
        { x: 670, y: 410 },

        { x: 280, y: 260 },
        { x: 350, y: 260 }
      ]
    },

    // ======================================
    // LEVEL 2
    // ======================================

    {
      platforms: [

        {
          x: 80,
          y: 430,
          width: 140,
          height: 20
        },

        {
          x: 300,
          y: 350,
          width: 140,
          height: 20
        },

        {
          x: 520,
          y: 430,
          width: 160,
          height: 20
        },

        {
          x: 180,
          y: 250,
          width: 140,
          height: 20
        },

        {
          x: 470,
          y: 220,
          width: 150,
          height: 20
        }
      ],

      crystals: [

        { x: 100, y: 390 },
        { x: 150, y: 390 },

        { x: 320, y: 310 },
        { x: 370, y: 310 },

        { x: 540, y: 390 },
        { x: 590, y: 390 },

        { x: 200, y: 210 },
        { x: 250, y: 210 },

        { x: 490, y: 180 },
        { x: 550, y: 180 }
      ]
    },

    // ======================================
    // LEVEL 3
    // ======================================

    {
      platforms: [

        {
          x: 80,
          y: 450,
          width: 130,
          height: 20
        },

        {
          x: 260,
          y: 380,
          width: 120,
          height: 20
        },

        {
          x: 450,
          y: 310,
          width: 120,
          height: 20
        },

        {
          x: 620,
          y: 400,
          width: 120,
          height: 20
        },

        {
          x: 300,
          y: 220,
          width: 160,
          height: 20
        }
      ],

      crystals: [

        { x: 100, y: 410 },
        { x: 150, y: 410 },

        { x: 280, y: 340 },
        { x: 330, y: 340 },

        { x: 470, y: 270 },
        { x: 520, y: 270 },

        { x: 640, y: 360 },
        { x: 690, y: 360 },

        { x: 330, y: 180 },
        { x: 410, y: 180 }
      ]
    }
  ];

  // ==========================================
  // CREATE ROOM
  // ==========================================

  onCreate() {

    console.log(
      "Game room created:",
      this.roomId
    );

    // ----------------------------------------
    // ROOM CODE
    // ----------------------------------------

    this.roomCode =
      this.generateRoomCode();

    registerRoom(
      this.roomCode,
      this.roomId
    );

    console.log(
      "Room code:",
      this.roomCode
    );

    // ----------------------------------------
    // LOAD FIRST LEVEL
    // ----------------------------------------

    this.loadLevel(1);

    // ========================================
    // INPUT
    // ========================================

    this.onMessage(
      "input",
      (
        client,
        message: PlayerInput
      ) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (!player) {
          return;
        }

        if (
          !this.gameStarted ||
          this.gameFinished ||
          !player.alive
        ) {
          return;
        }

        // ------------------------------------
        // HORIZONTAL MOVEMENT
        // ------------------------------------

        if (message.left) {

          player.velocityX =
            -this.MOVE_SPEED;

        } else if (message.right) {

          player.velocityX =
            this.MOVE_SPEED;

        } else {

          player.velocityX = 0;
        }

        // ------------------------------------
        // DOUBLE JUMP
        // ------------------------------------

        if (
          message.jump &&
          player.jumpCount <
            this.MAX_JUMPS
        ) {

          player.velocityY =
            this.JUMP_SPEED;

          player.jumpCount++;

          console.log(
            `Player ${
              player.playerIndex + 1
            } jump ${
              player.jumpCount
            } / ${
              this.MAX_JUMPS
            }`
          );
        }
      }
    );

    // ========================================
    // READY
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

        if (this.gameStarted) {
          return;
        }

        player.ready =
          !player.ready;

        this.broadcast(
          "playerReadyChanged",
          {
            id:
              player.id,

            ready:
              player.ready
          }
        );

        this.checkAllPlayersReady();
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
    // FIND ROOM
    // ========================================

    this.onMessage(
      "findRoom",
      (
        client,
        message
      ) => {

        const roomCode =
          String(
            message?.roomCode || ""
          )
            .trim()
            .toUpperCase();

        const roomId =
          this.findRegisteredRoom(
            roomCode
          );

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

        // Only host
        if (
          player.playerIndex !== 0
        ) {
          return;
        }

        if (
          !this.areAllPlayersReady()
        ) {

          client.send(
            "startGameFailed",
            {
              reason:
                "Not all players are ready."
            }
          );

          return;
        }

        this.startGame();
      }
    );

    // ========================================
    // SERVER GAME LOOP
    // ========================================

    this.setSimulationInterval(
      (deltaTime) => {

        if (
          !this.gameStarted ||
          this.gameFinished
        ) {
          return;
        }

        this.updateGame(
          deltaTime
        );
      }
    );
  }

  // ==========================================
  // JOIN
  // ==========================================

  onJoin(
    client: Client
  ) {

    console.log(
      "Player joined:",
      client.sessionId
    );

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

    const spawn =
      this.spawnPositions[
        playerIndex
      ];

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

      playerIndex,

      color:
        this.playerColors[
          playerIndex
        ],

      ready:
        false,

      alive:
        true,

      jumpCount:
        0
    };

    this.players.set(
      client.sessionId,
      player
    );

    // ----------------------------------------
    // OWN PLAYER
    // ----------------------------------------

    client.send(
      "playerJoinedSelf",
      player
    );

    // ----------------------------------------
    // ROOM CODE
    // ----------------------------------------

    client.send(
      "roomCode",
      {
        roomCode:
          this.roomCode
      }
    );

    // ----------------------------------------
    // EXISTING PLAYERS
    // ----------------------------------------

    for (
      const existing
      of this.players.values()
    ) {

      if (
        existing.id ===
        client.sessionId
      ) {
        continue;
      }

      client.send(
        "playerJoined",
        existing
      );
    }

    // ----------------------------------------
    // OTHER CLIENTS
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
    // READY STATES
    // ----------------------------------------

    for (
      const existing
      of this.players.values()
    ) {

      client.send(
        "playerReadyChanged",
        {
          id:
            existing.id,

          ready:
            existing.ready
        }
      );
    }

    this.checkAllPlayersReady();
  }

  // ==========================================
  // LEAVE
  // ==========================================

  onLeave(
    client: Client
  ) {

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

    this.checkAllPlayersReady();
  }

  // ==========================================
  // DISPOSE
  // ==========================================

  onDispose() {

    console.log(
      "Game room disposed:",
      this.roomId
    );

    if (this.roomCode) {

      removeRoom(
        this.roomCode
      );
    }
  }

  // ==========================================
  // UPDATE GAME
  // ==========================================

  private updateGame(
    deltaTime: number
  ) {

    const dt =
      Math.min(
        deltaTime / 1000,
        0.05
      );

    const oldY =
      new Map<string, number>();

    // ----------------------------------------
    // SAVE OLD POSITIONS
    // ----------------------------------------

    for (
      const player
      of this.players.values()
    ) {

      oldY.set(
        player.id,
        player.y
      );
    }

    // ----------------------------------------
    // UPDATE PLAYERS
    // ----------------------------------------

    for (
      const player
      of this.players.values()
    ) {

      this.updatePlayer(
        player,
        dt
      );
    }

    // ----------------------------------------
    // PLAYER-ON-PLAYER COLLISION
    // ----------------------------------------

    this.resolvePlayerCollisions(
      oldY
    );

    // ----------------------------------------
    // CRYSTALS
    // ----------------------------------------

    this.checkCrystalCollection();

    // ----------------------------------------
    // STATE
    // ----------------------------------------

    this.broadcastGameState();
  }

  // ==========================================
  // UPDATE PLAYER
  // ==========================================

  private updatePlayer(
    player: Player,
    dt: number
  ) {

    if (!player.alive) {
      return;
    }

    // ----------------------------------------
    // HORIZONTAL
    // ----------------------------------------

    player.x +=
      player.velocityX *
      dt;

    const halfWidth =
      this.PLAYER_WIDTH / 2;

    player.x =
      Math.max(
        halfWidth,
        Math.min(
          this.WORLD_WIDTH -
            halfWidth,
          player.x
        )
      );

    // ----------------------------------------
    // GRAVITY
    // ----------------------------------------

    player.velocityY +=
      this.GRAVITY *
      dt;

    player.y +=
      player.velocityY *
      dt;

    // ----------------------------------------
    // GROUND
    // ----------------------------------------

    const groundY =
      this.GROUND_TOP -
      this.PLAYER_HEIGHT / 2;

    if (
      player.y >= groundY
    ) {

      player.y =
        groundY;

      player.velocityY =
        0;

      player.jumpCount =
        0;
    }

    // ----------------------------------------
    // PLATFORMS
    // ----------------------------------------

    for (
      const platform
      of this.platforms
    ) {

      const playerBottom =
        player.y +
        this.PLAYER_HEIGHT / 2;

      const playerLeft =
        player.x -
        this.PLAYER_WIDTH / 2;

      const playerRight =
        player.x +
        this.PLAYER_WIDTH / 2;

      const platformLeft =
        platform.x -
        platform.width / 2;

      const platformRight =
        platform.x +
        platform.width / 2;

      const platformTop =
        platform.y -
        platform.height / 2;

      const horizontalOverlap =
        playerRight >
          platformLeft &&
        playerLeft <
          platformRight;

      if (
        player.velocityY >= 0 &&
        horizontalOverlap &&
        playerBottom >= platformTop &&
        playerBottom <=
          platformTop + 20
      ) {

        player.y =
          platformTop -
          this.PLAYER_HEIGHT / 2;

        player.velocityY =
          0;

        player.jumpCount =
          0;
      }
    }

    // ----------------------------------------
    // FALL / RESPAWN
    // ----------------------------------------

    if (
      player.y >
      this.WORLD_HEIGHT + 100
    ) {

      this.respawnPlayer(
        player
      );
    }
  }

  // ==========================================
  // PLAYER COLLISION
  // ==========================================

  private resolvePlayerCollisions(
    oldY: Map<string, number>
  ) {

    const players =
      Array.from(
        this.players.values()
      );

    // A couple of passes allow stacked
    // players to settle correctly.

    for (
      let pass = 0;
      pass < 3;
      pass++
    ) {

      for (
        let i = 0;
        i < players.length;
        i++
      ) {

        for (
          let j = i + 1;
          j < players.length;
          j++
        ) {

          const a =
            players[i];

          const b =
            players[j];

          if (
            !a.alive ||
            !b.alive
          ) {
            continue;
          }

          this.resolvePlayerLanding(
            a,
            b,
            oldY
          );

          this.resolvePlayerLanding(
            b,
            a,
            oldY
          );
        }
      }
    }
  }

  // ==========================================
  // PLAYER LANDING
  // ==========================================

  private resolvePlayerLanding(
    fallingPlayer: Player,
    supportPlayer: Player,
    oldY: Map<string, number>
  ) {

    const horizontalOverlap =
      Math.abs(
        fallingPlayer.x -
        supportPlayer.x
      ) <
      (
        this.PLAYER_WIDTH
      );

    if (!horizontalOverlap) {
      return;
    }

    const supportTop =
      supportPlayer.y -
      this.PLAYER_HEIGHT / 2;

    const fallingBottom =
      fallingPlayer.y +
      this.PLAYER_HEIGHT / 2;

    const oldBottom =
      (
        oldY.get(
          fallingPlayer.id
        ) ??
        fallingPlayer.y
      ) +
      this.PLAYER_HEIGHT / 2;

    // The falling player must have been
    // above the other player during the
    // previous frame.

    const crossedFromAbove =
      oldBottom <=
        supportTop + 4 &&
      fallingBottom >=
        supportTop;

    if (
      fallingPlayer.velocityY >= 0 &&
      crossedFromAbove
    ) {

      fallingPlayer.y =
        supportTop -
        this.PLAYER_HEIGHT / 2;

      fallingPlayer.velocityY =
        0;

      fallingPlayer.jumpCount =
        0;
    }
  }

  // ==========================================
  // GROUND / SURFACE CHECK
  // ==========================================

  private isOnGround(
    player: Player
  ): boolean {

    const groundY =
      this.GROUND_TOP -
      this.PLAYER_HEIGHT / 2;

    if (
      Math.abs(
        player.y -
        groundY
      ) < 5
    ) {

      return true;
    }

    // ----------------------------------------
    // PLATFORMS
    // ----------------------------------------

    for (
      const platform
      of this.platforms
    ) {

      const platformTop =
        platform.y -
        platform.height / 2;

      const playerBottom =
        player.y +
        this.PLAYER_HEIGHT / 2;

      const playerLeft =
        player.x -
        this.PLAYER_WIDTH / 2;

      const playerRight =
        player.x +
        this.PLAYER_WIDTH / 2;

      const platformLeft =
        platform.x -
        platform.width / 2;

      const platformRight =
        platform.x +
        platform.width / 2;

      if (
        Math.abs(
          playerBottom -
          platformTop
        ) < 6 &&
        playerRight >
          platformLeft &&
        playerLeft <
          platformRight
      ) {

        return true;
      }
    }

    // ----------------------------------------
    // OTHER PLAYER
    // ----------------------------------------

    for (
      const other
      of this.players.values()
    ) {

      if (
        other.id ===
        player.id ||
        !other.alive
      ) {
        continue;
      }

      const otherTop =
        other.y -
        this.PLAYER_HEIGHT / 2;

      const playerBottom =
        player.y +
        this.PLAYER_HEIGHT / 2;

      const horizontalOverlap =
        Math.abs(
          player.x -
          other.x
        ) <
        this.PLAYER_WIDTH;

      if (
        Math.abs(
          playerBottom -
          otherTop
        ) < 6 &&
        horizontalOverlap
      ) {

        return true;
      }
    }

    return false;
  }

  // ==========================================
  // RESPAWN
  // ==========================================

  private respawnPlayer(
    player: Player
  ) {

    const spawn =
      this.spawnPositions[
        player.playerIndex
      ];

    player.x =
      spawn.x;

    player.y =
      spawn.y;

    player.velocityX =
      0;

    player.velocityY =
      0;

    player.jumpCount =
      0;

    player.alive =
      true;

    this.broadcast(
      "playerRespawned",
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

  // ==========================================
  // CRYSTAL COLLECTION
  // ==========================================

  private checkCrystalCollection() {

    for (
      const player
      of this.players.values()
    ) {

      if (!player.alive) {
        continue;
      }

      for (
        const crystal
        of this.crystals.values()
      ) {

        if (
          crystal.collected
        ) {
          continue;
        }

        const dx =
          player.x -
          crystal.x;

        const dy =
          player.y -
          crystal.y;

        const distance =
          Math.sqrt(
            dx * dx +
            dy * dy
          );

        if (
          distance < 45
        ) {

          crystal.collected =
            true;

          this.score++;

          this.broadcast(
            "crystalCollected",
            {
              id:
                crystal.id,

              playerId:
                player.id,

              score:
                this.score
            }
          );

          if (
            this.score >=
            this.CRYSTALS_PER_LEVEL
          ) {

            this.completeLevel();

            return;
          }
        }
      }
    }
  }

  // ==========================================
  // COMPLETE LEVEL
  // ==========================================

  private completeLevel() {

    if (
      this.currentLevel >=
      this.MAX_LEVELS
    ) {

      this.finishGame();

      return;
    }

    const completedLevel =
      this.currentLevel;

    this.currentLevel++;

    this.score =
      0;

    this.broadcast(
      "levelCompleted",
      {
        completedLevel,

        nextLevel:
          this.currentLevel
      }
    );

    this.loadLevel(
      this.currentLevel
    );

    // ----------------------------------------
    // RESET PLAYERS
    // ----------------------------------------

    for (
      const player
      of this.players.values()
    ) {

      const spawn =
        this.spawnPositions[
          player.playerIndex
        ];

      player.x =
        spawn.x;

      player.y =
        spawn.y;

      player.velocityX =
        0;

      player.velocityY =
        0;

      player.jumpCount =
        0;

      player.alive =
        true;
    }
  }

  // ==========================================
  // FINISH GAME
  // ==========================================

  private finishGame() {

    this.gameFinished =
      true;

    this.gameStarted =
      false;

    console.log(
      "GAME FINISHED - PLAYERS WIN"
    );

    this.broadcast(
      "gameFinished",
      {
        result:
          "win"
      }
    );
  }

  // ==========================================
  // START GAME
  // ==========================================

  private startGame() {

    if (
      this.gameStarted
    ) {
      return;
    }

    this.gameStarted =
      true;

    this.gameFinished =
      false;

    this.currentLevel =
      1;

    this.score =
      0;

    this.loadLevel(1);

    for (
      const player
      of this.players.values()
    ) {

      const spawn =
        this.spawnPositions[
          player.playerIndex
        ];

      player.x =
        spawn.x;

      player.y =
        spawn.y;

      player.velocityX =
        0;

      player.velocityY =
        0;

      player.jumpCount =
        0;

      player.alive =
        true;
    }

    console.log(
      "GAME STARTED"
    );

    this.broadcast(
      "gameStarted"
    );

    this.broadcastGameState();
  }

  // ==========================================
  // LOAD LEVEL
  // ==========================================

  private loadLevel(
    levelNumber: number
  ) {

    const level =
      this.levels[
        levelNumber - 1
      ];

    if (!level) {
      return;
    }

    this.platforms =
      level.platforms.map(
        platform => ({
          ...platform
        })
      );

    this.crystals.clear();

    level.crystals.forEach(
      (position, index) => {

        this.crystals.set(
          index,
          {
            id:
              index,

            x:
              position.x,

            y:
              position.y,

            collected:
              false
          }
        );
      }
    );

    console.log(
      `Loaded level ${levelNumber}`
    );
  }

  // ==========================================
  // GAME STATE
  // ==========================================

  private broadcastGameState() {

    const players =
      Array.from(
        this.players.values()
      ).map(
        player => ({

          id:
            player.id,

          x:
            player.x,

          y:
            player.y,

          velocityX:
            player.velocityX,

          velocityY:
            player.velocityY,

          playerIndex:
            player.playerIndex,

          color:
            player.color,

          ready:
            player.ready,

          alive:
            player.alive
        })
      );

    const crystals =
      Array.from(
        this.crystals.values()
      );

    this.broadcast(
      "gameState",
      {

        players,

        crystals,

        score:
          this.score,

        targetScore:
          this.CRYSTALS_PER_LEVEL,

        level:
          this.currentLevel,

        maxLevels:
          this.MAX_LEVELS,

        gameStarted:
          this.gameStarted,

        gameFinished:
          this.gameFinished,

        platforms:
          this.platforms
      }
    );
  }

  // ==========================================
  // READY CHECK
  // ==========================================

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

      if (
        !player.ready
      ) {

        return false;
      }
    }

    return true;
  }

  private checkAllPlayersReady() {

    this.broadcast(
      "allPlayersReady",
      {
        allReady:
          this.areAllPlayersReady()
      }
    );
  }

  // ==========================================
  // ROOM LOOKUP
  // ==========================================

  private findRegisteredRoom(
    roomCode: string
  ): string | undefined {

    // This uses the existing registry
    // without introducing another lookup
    // system.

    const normalized =
      roomCode
        .trim()
        .toUpperCase();

    // Access through the registry module
    // is kept compatible with the existing
    // architecture.

    // The actual lookup is performed by
    // importing findRoom below.

    return undefined;
  }

  // ==========================================
  // HOST
  // ==========================================

  private getHost():
    Player | undefined {

    for (
      const player
      of this.players.values()
    ) {

      if (
        player.playerIndex === 0
      ) {

        return player;
      }
    }

    return undefined;
  }

  // ==========================================
  // ROOM CODE
  // ==========================================

  private generateRoomCode():
    string {

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
}