import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

// ==========================================
// PLAYER DATA
// ==========================================

interface PlayerData {
  id: string;
  x: number;
  y: number;

  playerIndex: number;
  color: number;
  ready: boolean;
}

// ==========================================
// REMOTE PLAYER
// ==========================================

interface RemotePlayer {
  id: string;
  sprite: Phaser.Physics.Arcade.Sprite;
}

// ==========================================
// DATA RECEIVED FROM LOBBY
// ==========================================

interface GameSceneData {
  room: Room;
  players: PlayerData[];
  myPlayer?: PlayerData;
}

// ==========================================
// GAME SCENE
// ==========================================

export class GameScene extends Phaser.Scene {

  // ==========================================
  // LOCAL PLAYER
  // ==========================================

  private player!:
    Phaser.Physics.Arcade.Sprite;

  private cursors!:
    Phaser.Types.Input.Keyboard.CursorKeys;

  // ==========================================
  // COLYSEUS ROOM
  // ==========================================

  private room!: Room;

  // ==========================================
  // PLAYER DATA
  // ==========================================

  private players:
    PlayerData[] = [];

  private myPlayerData!:
    PlayerData;

  // ==========================================
  // REMOTE PLAYERS
  // ==========================================

  private remotePlayers:
    Map<string, RemotePlayer> =
    new Map();

  // ==========================================
  // PHYSICS
  // ==========================================

  private ground!:
    Phaser.Physics.Arcade.StaticBody;

  // ==========================================
  // INPUT
  // ==========================================

  private jumpWasDown =
    false;

  // ==========================================
  // CONSTRUCTOR
  // ==========================================

  constructor() {

    super("GameScene");

  }

  // ==========================================
  // INIT
  // RECEIVE DATA FROM LOBBY
  // ==========================================

  init(
    data: GameSceneData
  ) {

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
    // USE EXISTING COLYSEUS ROOM
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
    // RECEIVE ALL PLAYERS
    // ----------------------------------------

    this.players =
      data.players || [];

    console.log(
      "Players received:",
      this.players
    );

    // ----------------------------------------
    // RECEIVE OUR PLAYER
    // ----------------------------------------

    if (data.myPlayer) {

      this.myPlayerData =
        data.myPlayer;

    }

    // ----------------------------------------
    // FALLBACK
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

    // ----------------------------------------
    // CREATE PLAYER TEXTURE
    // ----------------------------------------

    this.createPlayerTexture();

    // ----------------------------------------
    // CREATE WORLD
    // ----------------------------------------

    this.createWorld();

    // ----------------------------------------
    // KEYBOARD
    // ----------------------------------------

    this.cursors =
      this.input.keyboard!.createCursorKeys();

    // ----------------------------------------
    // APPLY SERVER PLAYER DATA
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
        "Local player:",
        this.myPlayerData
      );

    }

    // ----------------------------------------
    // CREATE OTHER PLAYERS
    // ----------------------------------------

    this.createExistingPlayers();

    // ----------------------------------------
    // SETUP NETWORK LISTENERS
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

    // ----------------------------------------
    // LOCAL PLAYER
    // ----------------------------------------

    this.player =
      this.physics.add.sprite(
        250,
        300,
        "player"
      );

    this.player.setTint(
      0xffffff
    );

    this.player.setCollideWorldBounds(
      true
    );

    // ----------------------------------------
    // GROUND
    // ----------------------------------------

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

    this.ground =
      ground.body as
        Phaser.Physics.Arcade.StaticBody;

    // ----------------------------------------
    // LOCAL PLAYER COLLISION
    // ----------------------------------------

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
      (
        player: PlayerData
      ) => {

        console.log(
          "New player joined:",
          player
        );

        // ------------------------------------
        // DON'T CREATE OURSELVES
        // ------------------------------------

        if (
          player.id ===
          this.room.sessionId
        ) {

          return;

        }

        // ------------------------------------
        // CREATE PLAYER
        // ------------------------------------

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
      (
        player: {
          id: string;
          x: number;
          y: number;
        }
      ) => {

        // ------------------------------------
        // IGNORE OUR OWN MOVEMENT
        // ------------------------------------

        if (
          player.id ===
          this.room.sessionId
        ) {

          return;

        }

        // ------------------------------------
        // FIND REMOTE PLAYER
        // ------------------------------------

        const remotePlayer =
          this.remotePlayers.get(
            player.id
          );

        // ------------------------------------
        // PLAYER NOT CREATED YET
        // ------------------------------------

        if (!remotePlayer) {

          console.warn(
            "Received movement for unknown player:",
            player.id
          );

          return;

        }

        // ------------------------------------
        // UPDATE REMOTE POSITION
        // ------------------------------------

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
      (
        data: {
          id: string;
        }
      ) => {

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

        // ------------------------------------
        // DESTROY SPRITE
        // ------------------------------------

        remotePlayer.sprite.destroy();

        // ------------------------------------
        // REMOVE FROM MAP
        // ------------------------------------

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

    // ----------------------------------------
    // DON'T CREATE OURSELVES
    // ----------------------------------------

    if (
      player.id ===
      this.room.sessionId
    ) {

      return;

    }

    // ----------------------------------------
    // PREVENT DUPLICATES
    // ----------------------------------------

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
      "P:",
      player.playerIndex + 1,
      "Color:",
      player.color
    );

    // ----------------------------------------
    // CREATE SPRITE
    // ----------------------------------------

    const sprite =
      this.physics.add.sprite(
        player.x,
        player.y,
        "player"
      );

    // ----------------------------------------
    // APPLY SERVER COLOR
    // ----------------------------------------

    sprite.setTint(
      player.color
    );

    sprite.setCollideWorldBounds(
      true
    );

    // ----------------------------------------
    // COLLISION WITH EXISTING GROUND
    // ----------------------------------------

    if (this.ground) {

      this.physics.add.collider(
        sprite,
        this.ground
      );

    }

    // ----------------------------------------
    // STORE REMOTE PLAYER
    // ----------------------------------------

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

    // ----------------------------------------
    // SAFETY
    // ----------------------------------------

    if (
      !this.player ||
      !this.cursors ||
      !this.room
    ) {

      return;

    }

    const speed =
      200;

    // ========================================
    // LEFT
    // ========================================

    if (
      this.cursors.left.isDown
    ) {

      this.player.setVelocityX(
        -speed
      );

    }

    // ========================================
    // RIGHT
    // ========================================

    else if (
      this.cursors.right.isDown
    ) {

      this.player.setVelocityX(
        speed
      );

    }

    // ========================================
    // STOP
    // ========================================

    else {

      this.player.setVelocityX(
        0
      );

    }

    // ========================================
    // JUMP
    // ========================================

    const jump =
      this.cursors.up.isDown;

    const jumpPressed =
      jump &&
      !this.jumpWasDown;

    this.jumpWasDown =
      jump;

    if (
      jumpPressed &&
      this.player.body
    ) {

      const body =
        this.player.body as
          Phaser.Physics.Arcade.Body;

      if (
        body.blocked.down
      ) {

        this.player.setVelocityY(
          -450
        );

      }
    }

    // ========================================
    // SEND POSITION TO SERVER
    // ========================================
    //
    // GameRoom currently handles "move",
    // so we send our current position.
    //

    this.room.send(
      "move",
      {
        x:
          this.player.x,

        y:
          this.player.y
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