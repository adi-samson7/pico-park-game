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
// GAME SCENE DATA
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

  private player!:
    Phaser.Physics.Arcade.Sprite;

  private cursors!:
    Phaser.Types.Input.Keyboard.CursorKeys;

  private room!: Room;

  private players:
    PlayerData[] = [];

  private myPlayerData!:
    PlayerData;

  private remotePlayers:
    Map<string, RemotePlayer> =
    new Map();

  private ground!:
    Phaser.Physics.Arcade.StaticBody;

  private lastInput = {
    left: false,
    right: false,
    jump: false
  };

  constructor() {

    super("GameScene");

  }

  // ==========================================
  // INIT
  // ==========================================

  init(
    data: GameSceneData
  ) {

    this.room =
      data.room;

    this.players =
      data.players || [];

    if (data.myPlayer) {

      this.myPlayerData =
        data.myPlayer;

    }

    if (!this.myPlayerData) {

      const me =
        this.players.find(
          player =>
            player.id ===
            this.room.sessionId
        );

      if (me) {

        this.myPlayerData =
          me;

      }
    }

    console.log(
      "GameScene initialized"
    );

    console.log(
      "Room:",
      this.room.roomId
    );

    console.log(
      "My player:",
      this.myPlayerData
    );
  }

  // ==========================================
  // CREATE
  // ==========================================

  create() {

    this.createPlayerTexture();

    this.createWorld();

    this.cursors =
      this.input.keyboard!.createCursorKeys();

    // ----------------------------------------
    // APPLY SERVER SPAWN
    // ----------------------------------------

    if (
      this.myPlayerData
    ) {

      this.player.setPosition(
        this.myPlayerData.x,
        this.myPlayerData.y
      );

      this.player.setTint(
        this.myPlayerData.color
      );
    }

    // ----------------------------------------
    // CREATE OTHER PLAYERS
    // ----------------------------------------

    this.createExistingPlayers();

    // ----------------------------------------
    // NETWORK
    // ----------------------------------------

    this.setupRoomListeners();
  }

  // ==========================================
  // PLAYER TEXTURE
  // ==========================================

  private createPlayerTexture() {

    if (
      this.textures.exists(
        "player"
      )
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
  // WORLD
  // ==========================================

  private createWorld() {

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

    this.physics.add.collider(
      this.player,
      ground
    );
  }

  // ==========================================
  // EXISTING PLAYERS
  // ==========================================

  private createExistingPlayers() {

    for (
      const player
      of this.players
    ) {

      if (
        player.id ===
        this.room.sessionId
      ) {

        continue;

      }

      this.createRemotePlayer(
        player
      );
    }
  }

  // ==========================================
  // NETWORK LISTENERS
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
      (
        player: {
          id: string;
          x: number;
          y: number;
        }
      ) => {

        // ------------------------------------
        // LOCAL PLAYER
        // ------------------------------------

        if (
          player.id ===
          this.room.sessionId
        ) {

          /*
           * The server is authoritative.
           *
           * We don't calculate the final
           * position locally anymore.
           */

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
      (
        data: {
          id: string;
        }
      ) => {

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

    if (
      player.id ===
      this.room.sessionId
    ) {

      return;

    }

    if (
      this.remotePlayers.has(
        player.id
      )
    ) {

      return;

    }

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

    if (this.ground) {

      this.physics.add.collider(
        sprite,
        this.ground
      );

    }

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
  // SEND INPUT
  // ==========================================

  private sendInput() {

    if (!this.room) {

      return;

    }

    const input = {

      left:
        this.cursors.left.isDown,

      right:
        this.cursors.right.isDown,

      jump:
        this.cursors.up.isDown
    };

    // ----------------------------------------
    // DON'T SEND DUPLICATE INPUT
    // ----------------------------------------

    if (
      input.left ===
        this.lastInput.left &&

      input.right ===
        this.lastInput.right &&

      input.jump ===
        this.lastInput.jump
    ) {

      return;

    }

    this.lastInput =
      input;

    this.room.send(
      "input",
      input
    );
  }

  // ==========================================
  // UPDATE
  // ==========================================

  update() {

    if (
      !this.player ||
      !this.cursors ||
      !this.room
    ) {

      return;

    }

    // ----------------------------------------
    // NO LOCAL POSITION CALCULATION
    // ----------------------------------------
    //
    // The server now handles:
    //
    // velocity
    // gravity
    // jumping
    // ground collision
    // world bounds
    //
    // ----------------------------------------

    this.sendInput();
  }

  // ==========================================
  // SHUTDOWN
  // ==========================================

  shutdown() {

    for (
      const remotePlayer
      of this.remotePlayers.values()
    ) {

      remotePlayer.sprite.destroy();

    }

    this.remotePlayers.clear();
  }
}