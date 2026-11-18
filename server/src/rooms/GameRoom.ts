import { Room, Client } from "colyseus";

import { log } from "../log.js";

import {
  registerRoom,
  findRoom,
  removeRoom,
  roomCodeExists
} from "../roomRegistry.js";

import {
  EXIT_HEIGHT,
  EXIT_REACH_Y,
  EXIT_WIDTH,
  LEVELS,
  SPAWN_POSITIONS,
  type LevelData,
  type Platform
} from "../levels.js";

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

  // False while the connection is lost and
  // the player is inside the reconnection
  // window. Such a player keeps their seat
  // but is not simulated, not solid and
  // does not block the exit or the lobby.
  connected: boolean;

  // Sequence number of the last input the
  // server applied. Echoed in every state
  // so the client can reconcile prediction.
  lastSeq: number;
}

interface PlayerInput {

  left?: boolean;

  right?: boolean;

  jump?: boolean;

  // Client-side input counter (see lastSeq).
  seq?: number;
}

interface Crystal {

  id: number;

  x: number;
  y: number;

  collected: boolean;
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

  private readonly EXIT_WIDTH = EXIT_WIDTH;

  private readonly EXIT_HEIGHT = EXIT_HEIGHT;

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
  // RECONNECTION
  // ========================================

  // How long a dropped player keeps their
  // seat. Read when a drop happens so tests
  // (and operators) can change it with the
  // RECONNECT_WINDOW_SECONDS variable.
  private reconnectWindowSeconds():
    number {

    const configured =
      Number(
        process.env
          .RECONNECT_WINDOW_SECONDS
      );

    return Number.isFinite(configured) &&
      configured > 0
      ? configured
      : 30;
  }

  // Latest round-trip time reported by
  // each player, in milliseconds.
  private rtts:
    Map<string, number> =
    new Map();

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

  private spawnPositions =
    SPAWN_POSITIONS;

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

  private levels: LevelData[] =
    LEVELS;

  // ==========================================
  // CREATE ROOM
  // ==========================================

  onCreate() {

    log(
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

    log(
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
          !player.alive ||
          !player.connected
        ) {
          return;
        }

        player.lastInputAt =
          Date.now();

        // Only ever move forward: a late or
        // forged number must not make the
        // client reconcile against the past.

        if (
          typeof message.seq === "number" &&
          Number.isFinite(message.seq) &&
          message.seq > player.lastSeq
        ) {

          player.lastSeq =
            Math.floor(message.seq);
        }

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
    // RESYNC
    // ========================================
    //
    // A client that suspects it missed
    // something (for example after its
    // connection came back) asks for the
    // whole picture again.

    this.onMessage(
      "requestResync",
      (client) => {

        const player =
          this.players.get(
            client.sessionId
          );

        if (player) {

          client.send(
            "resync",
            this.resyncPayload()
          );
        }
      }
    );

    // ========================================
    // LATENCY
    // ========================================
    //
    // Each client measures its own round trip
    // and reports it. The values are only
    // shown to players (never used by the
    // rules), so they are just sanity-checked.

    this.onMessage(
      "latency",
      (
        client,
        message
      ) => {

        const player =
          this.players.get(
            client.sessionId
          );

        const rtt =
          Number(message?.rtt);

        if (
          !player ||
          !Number.isFinite(rtt)
        ) {
          return;
        }

        this.rtts.set(
          player.id,
          Math.max(
            0,
            Math.min(
              5000,
              Math.round(rtt)
            )
          )
        );
      }
    );

    this.clock.setInterval(
      () => {

        this.broadcastLatencies();
      },
      1000
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

    log(
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
        Date.now(),

      connected:
        true,

      lastSeq:
        0
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

  // Also called, after the reconnection
  // window ran out, for a player who
  // dropped and never came back.

  onLeave(
    client: Client
  ) {

    log(
      "Player left:",
      client.sessionId
    );

    this.players.delete(
      client.sessionId
    );

    this.rtts.delete(
      client.sessionId
    );

    this.broadcast(
      "playerLeft",
      {
        id:
          client.sessionId
      }
    );

    this.electHost();

    this.checkAllPlayersReady();
  }

  // ==========================================
  // DROP (connection lost, not a "Leave")
  // ==========================================
  //
  // Network blip, closed laptop, page reload:
  // keep the player's seat for a while. The
  // client library retries on its own; if it
  // succeeds onReconnect() runs, if the time
  // runs out onLeave() removes the player.

  onDrop(
    client: Client,
    code?: number
  ) {

    const player =
      this.players.get(
        client.sessionId
      );

    // Nothing worth holding a seat for once
    // the game is over.

    if (
      !player ||
      this.gameFinished
    ) {
      return;
    }

    const seconds =
      this.reconnectWindowSeconds();

    log(
      "Player dropped:",
      client.sessionId,
      `(code ${code}),`,
      `holding the seat for ${seconds}s`
    );

    player.connected =
      false;

    player.velocityX =
      0;

    this.broadcast(
      "playerDropped",
      {
        id:
          player.id,

        seconds
      }
    );

    this.electHost();

    this.checkAllPlayersReady();

    this.allowReconnection(
      client,
      seconds
    ).catch(() => {

      // Timed out. The room now calls
      // onLeave() for this client.
    });
  }

  // ==========================================
  // RECONNECT
  // ==========================================

  onReconnect(
    client: Client
  ) {

    const player =
      this.players.get(
        client.sessionId
      );

    if (!player) {

      client.leave();

      return;
    }

    log(
      "Player reconnected:",
      client.sessionId
    );

    player.connected =
      true;

    player.lastInputAt =
      Date.now();

    // A reloaded page starts counting its
    // inputs from the beginning again.

    player.lastSeq =
      0;

    // Back at the spawn point: the world
    // moved on while they were away and the
    // old spot may now be occupied.

    if (this.gameStarted) {

      this.placeAtSpawn(
        player
      );
    }

    this.broadcast(
      "playerReconnected",
      {
        id:
          player.id,

        x:
          player.x,

        y:
          player.y
      }
    );

    this.electHost();

    // They missed everything that happened
    // while they were gone: send it all.

    client.send(
      "resync",
      this.resyncPayload()
    );

    this.checkAllPlayersReady();
  }

  // ==========================================
  // HOST
  // ==========================================
  //
  // The host must be someone who is actually
  // connected, otherwise the lobby could get
  // stuck waiting for a host who is gone. The
  // connected player with the lowest index
  // takes over.

  private electHost() {

    const current =
      this.players.get(
        this.hostId
      );

    if (current?.connected) {
      return;
    }

    const connected =
      Array.from(
        this.players.values()
      ).filter(
        player =>
          player.connected
      ).sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      );

    const next =
      connected[0];

    // Nobody connected: keep whoever is
    // there so they get the seat back.

    if (!next) {

      if (!current) {

        this.hostId =
          Array.from(
            this.players.values()
          )[0]?.id ?? "";
      }

      return;
    }

    this.hostId =
      next.id;

    this.broadcast(
      "hostChanged",
      {
        id:
          next.id
      }
    );
  }

  // ==========================================
  // RESYNC PAYLOAD
  // ==========================================
  //
  // Everything a client needs to rebuild its
  // picture of the room from scratch.

  private resyncPayload() {

    return {

      roomCode:
        this.roomCode,

      hostId:
        this.hostId,

      gameStarted:
        this.gameStarted,

      gameFinished:
        this.gameFinished,

      allReady:
        this.areAllPlayersReady(),

      players:
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

            playerIndex:
              player.playerIndex,

            color:
              player.color,

            ready:
              player.ready,

            alive:
              player.alive,

            connected:
              player.connected,

            jumpCount:
              player.jumpCount,

            grounded:
              player.grounded,

            velocityX:
              player.velocityX,

            velocityY:
              player.velocityY
          })
        ),

      level:
        this.gameStarted ||
        this.gameFinished
          ? this.levelPayload()
          : null
    };
  }

  // ==========================================
  // LATENCIES
  // ==========================================

  private broadcastLatencies() {

    const rtts:
      Record<string, number> = {};

    for (
      const [id, rtt]
      of this.rtts
    ) {

      if (this.players.has(id)) {

        rtts[id] = rtt;
      }
    }

    this.broadcast(
      "latencies",
      {
        rtts
      }
    );
  }

  private connectedPlayers():
    Player[] {

    return Array.from(
      this.players.values()
    ).filter(
      player =>
        player.connected
    );
  }

  // ==========================================
  // DISPOSE
  // ==========================================

  onDispose() {

    log(
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

    // Players whose connection dropped are
    // not simulated at all: they are not
    // solid, nobody can stand on them and
    // they stay where they were.

    const active =
      this.connectedPlayers();

    for (const player of active) {

      if (
        now - player.lastInputAt >
        this.INPUT_TIMEOUT_MS
      ) {

        player.velocityX = 0;
      }
    }

    const fallen =
      stepPlayers(
        active,
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

    for (const player of active) {

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
      of this.connectedPlayers()
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
      of this.connectedPlayers()
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
        ) < EXIT_REACH_Y
      ) {

        count++;
      }
    }

    return count;
  }

  // The level is complete when the door is
  // open and EVERY connected player is in it.
  // A player who dropped and may still come
  // back does not hold everyone else up.

  private checkExit() {

    const needed =
      this.connectedPlayers().length;

    if (
      !this.doorOpen ||
      needed === 0
    ) {
      return;
    }

    if (
      this.playersAtExit() ===
      needed
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

    log(
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

    log(
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

    log(
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
            player.grounded,

          standingOn:
            player.standingOn,

          connected:
            player.connected,

          // Last input the server applied
          // (for client prediction).
          ack:
            player.lastSeq
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
          this.playersAtExit(),

        // How many players the door waits
        // for (the connected ones).
        playersNeeded:
          this.connectedPlayers().length
      }
    );
  }

  // ==========================================
  // READY CHECK
  // ==========================================

  private areAllPlayersReady():
    boolean {

    // Players who dropped do not hold up the
    // start.

    const connected =
      this.connectedPlayers();

    if (
      connected.length === 0
    ) {
      return false;
    }

    for (
      const player
      of connected
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
