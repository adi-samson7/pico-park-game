import { Room, Client } from "colyseus";

import {
  registerRoom,
  findRoom,
  removeRoom,
  roomCodeExists
} from "../roomRegistry.js";

import {
  PHYSICS,
  stepPlayers,
  touchesSpikes,
  tryJump,
  type Pit,
  type Spikes
} from "../physics.js";

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

  // Resting on ground / platform / player.
  grounded: boolean;

  // Session id of the player below, if any.
  standingOn: string | null;

  // Timestamp of the last input message.
  lastInputAt: number;
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

  // Centre of the exit door. The door
  // opens once every crystal is collected
  // and the level ends when ALL players
  // are standing in it.
  exit: {
    x: number;
    y: number;
  };

  // Gaps in the ground. Falling in respawns
  // the player at their spawn point.
  pits: Pit[];

  // Spike strips. Touching one respawns
  // the player at their spawn point.
  spikes: Spikes[];

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

  // Crystals needed to open the exit
  // (set from the level data).
  private targetScore = 10;

  private doorOpen = false;

  // Hazards of the current level.
  private pits: Pit[] = [];

  private spikes: Spikes[] = [];

  private exit = {
    x: 0,
    y: 0
  };

  // Door box. It is wide enough for four
  // (solid, 40px) players side by side:
  // a player counts as inside when their
  // centre is within the door's width.
  private readonly EXIT_WIDTH = 140;

  private readonly EXIT_HEIGHT = 64;

  // ========================================
  // INPUT
  // ========================================

  // The client sends input every frame. If
  // nothing arrives for this long, the
  // player stops moving.
  private readonly INPUT_TIMEOUT_MS = 300;

  // ========================================
  // HOST
  // ========================================

  // Session id of the player allowed to
  // start the game.
  private hostId = "";

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
      exit: { x: 250, y: 258 },

      pits: [
        { x1: 610, x2: 730 }
      ],

      spikes: [
        { x: 235, y: 540, width: 70 }
      ],

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
        { x: 350, y: 260 },

        // over the pit
        { x: 640, y: 480 },
        { x: 690, y: 480 },
        { x: 765, y: 510 }
      ]
    },

    // ======================================
    // LEVEL 2
    // ======================================

    {
      exit: { x: 470, y: 178 },

      pits: [
        { x1: 220, x2: 390 }
      ],

      spikes: [
        { x: 480, y: 420, width: 40 },
        { x: 660, y: 540, width: 80 }
      ],

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
        { x: 550, y: 180 },

        // over the pit
        { x: 250, y: 490 },
        { x: 305, y: 470 },
        { x: 360, y: 490 }
      ]
    },

    // ======================================
    // LEVEL 3
    // ======================================

    {
      exit: { x: 300, y: 178 },

      pits: [
        { x1: 215, x2: 385 }
      ],

      spikes: [
        { x: 630, y: 540, width: 80 }
      ],

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
        { x: 410, y: 180 },

        // over the pit
        { x: 270, y: 490 },
        { x: 300, y: 470 },
        { x: 330, y: 490 }
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

        // Never trust the payload shape.

        if (
          !message ||
          typeof message !== "object"
        ) {
          return;
        }

        if (
          !this.gameStarted ||
          this.gameFinished ||
          !player.alive
        ) {
          return;
        }

        player.lastInputAt =
          Date.now();

        // ------------------------------------
        // HORIZONTAL MOVEMENT
        // ------------------------------------

        if (message.left === true) {

          player.velocityX =
            -PHYSICS.MOVE_SPEED;

        } else if (
          message.right === true
        ) {

          player.velocityX =
            PHYSICS.MOVE_SPEED;

        } else {

          player.velocityX = 0;
        }

        // ------------------------------------
        // DOUBLE JUMP
        // ------------------------------------

        if (message.jump === true) {

          tryJump(player);
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
          player.id !== this.hostId
        ) {
          return;
        }

        if (
          this.gameStarted ||
          this.gameFinished
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
    // REQUEST LEVEL
    // ========================================
    //
    // Level geometry is sent once, not every
    // tick. A client asks for it when its
    // game scene is ready (the broadcast at
    // level load can arrive before that).

    this.onMessage(
      "requestLevel",
      (client) => {

        client.send(
          "levelLoaded",
          this.levelPayload()
        );
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
        0,

      grounded:
        false,

      standingOn:
        null,

      lastInputAt:
        Date.now()
    };

    this.players.set(
      client.sessionId,
      player
    );

    // First player in becomes host.

    if (!this.hostId) {

      this.hostId =
        client.sessionId;
    }

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

    // ----------------------------------------
    // HOST
    // ----------------------------------------

    client.send(
      "hostChanged",
      {
        id:
          this.hostId
      }
    );

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

    // ----------------------------------------
    // HOST MIGRATION
    // ----------------------------------------
    //
    // If the host leaves, the player with
    // the lowest index takes over so the
    // lobby can never get stuck.

    if (
      client.sessionId ===
      this.hostId
    ) {

      const next =
        Array.from(
          this.players.values()
        ).sort(
          (a, b) =>
            a.playerIndex -
            b.playerIndex
        )[0];

      this.hostId =
        next?.id ?? "";

      if (next) {

        this.broadcast(
          "hostChanged",
          {
            id:
              next.id
          }
        );
      }
    }

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

    const now =
      Date.now();

    // A client that stops sending input
    // (closed laptop, hidden tab) must not
    // keep running in its last direction.

    for (
      const player
      of this.players.values()
    ) {

      if (
        now - player.lastInputAt >
        this.INPUT_TIMEOUT_MS
      ) {

        player.velocityX = 0;
      }
    }

    const fallen =
      stepPlayers(
        Array.from(
          this.players.values()
        ),
        this.platforms,
        deltaTime / 1000,
        this.pits
      );

    for (const id of fallen) {

      const player =
        this.players.get(id);

      if (player) {

        this.respawnPlayer(
          player,
          "fell"
        );
      }
    }

    for (
      const player
      of this.players.values()
    ) {

      if (
        player.alive &&
        touchesSpikes(
          player,
          this.spikes
        )
      ) {

        this.respawnPlayer(
          player,
          "spikes"
        );
      }
    }

    this.checkCrystalCollection();

    this.checkExit();

    this.broadcastGameState();
  }

  // ==========================================
  // PLACE AT SPAWN
  // ==========================================

  private placeAtSpawn(
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

    player.grounded =
      false;

    player.standingOn =
      null;

    player.alive =
      true;
  }

  // ==========================================
  // RESPAWN
  // ==========================================

  private respawnPlayer(
    player: Player,
    cause: "fell" | "spikes"
  ) {

    this.placeAtSpawn(
      player
    );

    this.broadcast(
      "playerRespawned",
      {
        id:
          player.id,

        x:
          player.x,

        y:
          player.y,

        cause
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
            !this.doorOpen &&
            this.score >=
              this.targetScore
          ) {

            this.doorOpen =
              true;

            this.broadcast(
              "doorOpened"
            );
          }
        }
      }
    }
  }

  // ==========================================
  // EXIT DOOR
  // ==========================================

  private playersAtExit():
    number {

    let count = 0;

    for (
      const player
      of this.players.values()
    ) {

      if (!player.alive) {
        continue;
      }

      if (
        Math.abs(
          player.x -
          this.exit.x
        ) < this.EXIT_WIDTH / 2 &&
        Math.abs(
          player.y -
          this.exit.y
        ) < 36
      ) {

        count++;
      }
    }

    return count;
  }

  // The level is complete when the door is
  // open and EVERY connected player is in it.

  private checkExit() {

    if (
      !this.doorOpen ||
      this.players.size === 0
    ) {
      return;
    }

    if (
      this.playersAtExit() ===
      this.players.size
    ) {

      this.completeLevel();
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

      this.placeAtSpawn(
        player
      );
    }

    this.broadcast(
      "levelLoaded",
      this.levelPayload()
    );
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

    // No one may join a game in progress.
    this.lock();

    this.currentLevel =
      1;

    this.score =
      0;

    this.loadLevel(1);

    for (
      const player
      of this.players.values()
    ) {

      this.placeAtSpawn(
        player
      );
    }

    console.log(
      "GAME STARTED"
    );

    this.broadcast(
      "gameStarted"
    );

    this.broadcast(
      "levelLoaded",
      this.levelPayload()
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

    this.exit = {
      ...level.exit
    };

    this.doorOpen =
      false;

    this.pits =
      level.pits.map(
        pit => ({
          ...pit
        })
      );

    this.spikes =
      level.spikes.map(
        strip => ({
          ...strip
        })
      );

    this.targetScore =
      level.crystals.length;

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
  // LEVEL PAYLOAD
  // ==========================================
  //
  // Static level geometry plus current
  // crystal state. Sent when a level loads
  // (and on request), NOT every tick.

  private levelPayload() {

    return {

      level:
        this.currentLevel,

      maxLevels:
        this.MAX_LEVELS,

      targetScore:
        this.targetScore,

      score:
        this.score,

      platforms:
        this.platforms,

      crystals:
        Array.from(
          this.crystals.values()
        ),

      exit: {
        ...this.exit,

        width:
          this.EXIT_WIDTH,

        height:
          this.EXIT_HEIGHT
      },

      doorOpen:
        this.doorOpen,

      pits:
        this.pits,

      spikes:
        this.spikes,

      spikeHeight:
        PHYSICS.SPIKE_HEIGHT
    };
  }

  // ==========================================
  // GAME STATE
  // ==========================================
  //
  // Sent every tick: keep it small.

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
            player.alive,

          jumpCount:
            player.jumpCount,

          grounded:
            player.grounded
        })
      );

    this.broadcast(
      "gameState",
      {

        players,

        score:
          this.score,

        targetScore:
          this.targetScore,

        level:
          this.currentLevel,

        maxLevels:
          this.MAX_LEVELS,

        gameStarted:
          this.gameStarted,

        gameFinished:
          this.gameFinished,

        doorOpen:
          this.doorOpen,

        playersAtExit:
          this.playersAtExit()
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

    return findRoom(
      roomCode
    );
  }

  // ==========================================
  // ROOM CODE
  // ==========================================

  // Six characters, unique among live rooms.

  private generateRoomCode():
    string {

    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    for (
      let attempt = 0;
      attempt < 100;
      attempt++
    ) {

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

      if (
        !roomCodeExists(code)
      ) {

        return code;
      }
    }

    throw new Error(
      "Could not generate a unique room code."
    );
  }
}
