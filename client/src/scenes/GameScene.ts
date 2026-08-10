import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

interface PlayerData {
  id: string;
  x: number;
  y: number;

  velocityX?: number;
  velocityY?: number;

  playerIndex: number;
  color: number;
  ready: boolean;
}

interface RemotePlayer {
  id: string;
  sprite: Phaser.Physics.Arcade.Sprite;
}

interface GameSceneData {
  room: Room;
  players: PlayerData[];
  myPlayer?: PlayerData;
}

export class GameScene extends Phaser.Scene {

  // ==========================================
  // PLAYER
  // ==========================================

  private player!:
    Phaser.Physics.Arcade.Sprite;

  private cursors!:
    Phaser.Types.Input.Keyboard.CursorKeys;

  // ==========================================
  // NETWORK
  // ==========================================

  private room!: Room;

  // All players received from LobbyScene

  private players: PlayerData[] = [];

  // Our own player data

  private myPlayerData!:
    PlayerData;

  // Other players

  private remotePlayers:
    Map<string, RemotePlayer> =
    new Map();

  // ==========================================
  // INPUT
  // ==========================================

  private jumpWasDown = false;

  constructor() {
    super("GameScene");
  }

  // ==========================================
  // INIT
  // ==========================================

  init(data: GameSceneData) {

    console.log(
      "================================"
    );

    console.log(
      "GameScene received data"
    );

    console.log(
      "================================"
    );

    // ----------------------------------------
    // ROOM
    // ----------------------------------------

    this.room =
      data.room;

    console.log(
      "Room ID:",
      this.room.roomId
    );

    console.log(
      "My session ID:",
      this.room.sessionId
    );

    // ----------------------------------------
    // PLAYER LIST
    // ----------------------------------------

    this.players =
      data.players || [];

    console.log(
      "Players received:",
      this.players
    );

    // ----------------------------------------
    // OUR PLAYER
    // ----------------------------------------

    if (data.myPlayer) {

      this.myPlayerData =
        data.myPlayer;

    }

    // ----------------------------------------
    // FALLBACK:
    // FIND OUR PLAYER IN PLAYER LIST
    // ----------------------------------------

    if (!this.myPlayerData) {

      const me =
        this.players.find(
          (player) =>
            player.id ===
            this.room.sessionId
        );

      if (me) {

        this.myPlayerData =
          me;
      }
    }

    console.log(
      "My player data:",
      this.myPlayerData
    );
  }

  // ==========================================
  // CREATE
  // ==========================================

  create() {

    console.log(
      "Starting GameScene..."
    );

    this.createPlayerTexture();

    this.createWorld();

    this.cursors =
      this.input.keyboard!.createCursorKeys();

    // ----------------------------------------
    // APPLY OUR SERVER PLAYER DATA
    // ----------------------------------------

    if (this.myPlayerData) {

      this.player.setPosition(
        this.myPlayerData.x,
        this.myPlayerData.y
      );

      this.player.setTint(
        this.myPlayerData.color
      );

      console.log(
        "Local player created:",
        this.myPlayerData
      );
    }

    // ----------------------------------------
    // CREATE OTHER PLAYERS
    // ----------------------------------------

    this.createExistingPlayers();

    // ----------------------------------------
    // NETWORK LISTENERS
    // ----------------------------------------

    this.setupRoomListeners();

    console.log(
      "GameScene ready."
    );
  }

  // ==========================================
  // CREATE PLAYER TEXTURE
  // ==========================================

  private createPlayerTexture() {

    // Don't recreate the texture if it
    // already exists.

    if (
      this.textures.exists("player")
    ) {

      return;
    }

    const graphics =
      this.add.graphics();

    graphics.fillStyle(
      0xffffff,
      1
    );

    graphics.fillRect(
      0,
      0,
      40,
      60
    );

    graphics.generateTexture(
      "player",
      40,
      60
    );

    graphics.destroy();
  }

  // ==========================================
  // CREATE WORLD
  // ==========================================

  private createWorld() {

    // ========================================
    // LOCAL PLAYER
    // ========================================

    this.player =
      this.physics.add.sprite(
        250,
        300,
        "player"
      );

    // White temporarily.
    //
    // Server color will be applied after
    // myPlayerData is received.

    this.player.setTint(
      0xffffff
    );

    this.player.setCollideWorldBounds(
      true
    );

    // ========================================
    // GROUND
    // ========================================

    const ground =
      this.add.rectangle(
        400,
        550,
        800,
        50,
        0x333333
      );

    this.physics.add.existing(
      ground,
      true
    );

    this.physics.add.collider(
      this.player,
      ground
    );
  }

  // ==========================================
  // CREATE EXISTING PLAYERS
  // ==========================================

  private createExistingPlayers() {

    console.log(
      "Creating existing players..."
    );

    for (
      const player
      of this.players
    ) {

      // --------------------------------------
      // DON'T CREATE OURSELVES
      // --------------------------------------

      if (
        player.id ===
        this.room.sessionId
      ) {

        continue;
      }

      // --------------------------------------
      // CREATE REMOTE PLAYER
      // --------------------------------------

      this.createRemotePlayer(
        player
      );
    }

    console.log(
      "Remote players:",
      this.remotePlayers.size
    );
  }

  // ==========================================
  // ROOM LISTENERS
  // ==========================================

  private setupRoomListeners() {

    // ========================================
    // PLAYER JOINED
    // ========================================

    this.room.onMessage(
      "playerJoined",
      (player: PlayerData) => {

        console.log(
          "New player joined:",
          player
        );

        // Don't create ourselves.

        if (
          player.id ===
          this.room.sessionId
        ) {

          return;
        }

        this.createRemotePlayer(
          player
        );
      }
    );

    // ========================================
    // PLAYER MOVED
    // ========================================

    this.room.onMessage(
      "playerMoved",
      (player: {
        id: string;
        x: number;
        y: number;
      }) => {

        // ------------------------------------
        // LOCAL PLAYER
        // ------------------------------------

        if (
          player.id ===
          this.room.sessionId
        ) {

          this.player.setPosition(
            player.x,
            player.y
          );

          return;
        }

        // ------------------------------------
        // REMOTE PLAYER
        // ------------------------------------

        const remotePlayer =
          this.remotePlayers.get(
            player.id
          );

        if (!remotePlayer) {

          console.warn(
            "Received movement for unknown player:",
            player.id
          );

          return;
        }

        remotePlayer.sprite.setPosition(
          player.x,
          player.y
        );
      }
    );

    // ========================================
    // PLAYER LEFT
    // ========================================

    this.room.onMessage(
      "playerLeft",
      (data: {
        id: string;
      }) => {

        console.log(
          "Player left:",
          data.id
        );

        const remotePlayer =
          this.remotePlayers.get(
            data.id
          );

        if (!remotePlayer) {

          return;
        }

        remotePlayer.sprite.destroy();

        this.remotePlayers.delete(
          data.id
        );
      }
    );
  }

  // ==========================================
  // CREATE REMOTE PLAYER
  // ==========================================

  private createRemotePlayer(
    player: PlayerData
  ) {

    // ========================================
    // SAFETY CHECK
    // ========================================

    if (
      player.id ===
      this.room.sessionId
    ) {

      return;
    }

    // ========================================
    // PREVENT DUPLICATES
    // ========================================

    if (
      this.remotePlayers.has(
        player.id
      )
    ) {

      return;
    }

    console.log(
      "Creating remote player:",
      player.id,
      "index:",
      player.playerIndex,
      "color:",
      player.color
    );

    // ========================================
    // CREATE SPRITE
    // ========================================

    const sprite =
      this.physics.add.sprite(
        player.x,
        player.y,
        "player"
      );

    sprite.setTint(
      player.color
    );

    sprite.setCollideWorldBounds(
      true
    );

    // ========================================
    // GROUND
    // ========================================

    const ground =
      this.add.rectangle(
        400,
        550,
        800,
        50,
        0x333333
      );

    this.physics.add.existing(
      ground,
      true
    );

    this.physics.add.collider(
      sprite,
      ground
    );

    // ========================================
    // STORE
    // ========================================

    this.remotePlayers.set(
      player.id,
      {
        id:
          player.id,

        sprite:
          sprite
      }
    );
  }

  // ==========================================
  // UPDATE
  // ==========================================

  update() {

    if (
      !this.room ||
      !this.player ||
      !this.cursors
    ) {

      return;
    }

    // ========================================
    // KEYBOARD INPUT
    // ========================================

    const left =
      this.cursors.left.isDown;

    const right =
      this.cursors.right.isDown;

    const jump =
      this.cursors.up.isDown;

    // ========================================
    // JUMP PRESS DETECTION
    // ========================================
    //
    // We only send jump=true once when
    // the key is pressed.
    //

    const jumpPressed =
      jump &&
      !this.jumpWasDown;

    this.jumpWasDown =
      jump;

    // ========================================
    // SEND INPUT TO SERVER
    // ========================================

    this.room.send(
      "input",
      {
        left:
          left,

        right:
          right,

        jump:
          jumpPressed
      }
    );
  }

  // ==========================================
  // SHUTDOWN
  // ==========================================

  shutdown() {

    console.log(
      "GameScene shutting down."
    );

    // ----------------------------------------
    // DESTROY REMOTE PLAYERS
    // ----------------------------------------

    for (
      const remotePlayer
      of this.remotePlayers.values()
    ) {

      remotePlayer.sprite.destroy();
    }

    this.remotePlayers.clear();
  }
}