import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

interface PlayerData {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
  ready: boolean;
}

interface RemotePlayer {
  id: string;
  sprite: Phaser.Physics.Arcade.Sprite;
}

export class GameScene extends Phaser.Scene {

  private player!: Phaser.Physics.Arcade.Sprite;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private room!: Room;

  private remotePlayers:
    Map<string, RemotePlayer> =
    new Map();

  constructor() {
    super("GameScene");
  }

  // ==========================================
  // CREATE
  // ==========================================

  async create() {

    this.createPlayerTexture();

    this.createWorld();

    this.cursors =
      this.input.keyboard!.createCursorKeys();

    await this.connectToServer();
  }

  // ==========================================
  // CREATE PLAYER TEXTURE
  // ==========================================

  private createPlayerTexture() {

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

    // Temporary position.
    // The server will assign the real
    // position after joining the room.

    this.player =
      this.physics.add.sprite(
        250,
        300,
        "player"
      );

    // Temporary default color.
    // Server will replace this.

    this.player.setTint(
      0xff4444
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

    this.physics.add.collider(
      this.player,
      ground
    );
  }

  // ==========================================
  // CONNECT TO COLYSEUS SERVER
  // ==========================================

  private async connectToServer() {

    try {

      const client =
        new (await import(
          "@colyseus/sdk"
        )).Client(
          "ws://localhost:2567"
        );

      console.log(
        "Connecting to game server..."
      );

      this.room =
        await client.joinOrCreate(
          "game"
        );

      console.log(
        "Connected to room:",
        this.room.roomId
      );

      console.log(
        "My session ID:",
        this.room.sessionId
      );

      this.setupRoomListeners();

    } catch (error) {

      console.error(
        "Could not connect to game server:",
        error
      );
    }
  }

  // ==========================================
  // ROOM MESSAGE LISTENERS
  // ==========================================

  private setupRoomListeners() {

    // ----------------------------------------
    // MY PLAYER DATA
    // ----------------------------------------

    this.room.onMessage(
      "playerJoinedSelf",
      (player: PlayerData) => {

        console.log(
          "My player data:",
          player
        );

        // Server-assigned spawn
        this.player.setPosition(
          player.x,
          player.y
        );

        // Server-assigned color
        this.player.setTint(
          player.color
        );
      }
    );

    // ----------------------------------------
    // PLAYER JOINED
    // ----------------------------------------

    this.room.onMessage(
      "playerJoined",
      (player: PlayerData) => {

        console.log(
          "Player joined:",
          player
        );

        // Don't create ourselves
        // as a remote player.

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

    // ----------------------------------------
    // PLAYER MOVED
    // ----------------------------------------

    this.room.onMessage(
      "playerMoved",
      (player: PlayerData) => {

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

    // ----------------------------------------
    // PLAYER LEFT
    // ----------------------------------------

    this.room.onMessage(
      "playerLeft",
      (player: { id: string }) => {

        console.log(
          "Player left:",
          player.id
        );

        const remotePlayer =
          this.remotePlayers.get(
            player.id
          );

        if (!remotePlayer) {
          return;
        }

        remotePlayer.sprite.destroy();

        this.remotePlayers.delete(
          player.id
        );
      }
    );

    // ----------------------------------------
    // READY STATUS CHANGED
    // ----------------------------------------

    this.room.onMessage(
      "playerReadyChanged",
      (data: {
        id: string;
        ready: boolean;
      }) => {

        console.log(
          "Ready changed:",
          data
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

    // Prevent duplicate players.

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

    // Use server-assigned color.

    sprite.setTint(
      player.color
    );

    sprite.setCollideWorldBounds(
      true
    );

    // ----------------------------------------
    // REMOTE PLAYER GROUND
    // ----------------------------------------

    const ground =
      this.add.rectangle(
        400,
        550,
        800,
        50
      );

    this.physics.add.existing(
      ground,
      true
    );

    this.physics.add.collider(
      sprite,
      ground
    );

    // ----------------------------------------
    // STORE REMOTE PLAYER
    // ----------------------------------------

    this.remotePlayers.set(
      player.id,
      {
        id: player.id,
        sprite: sprite
      }
    );
  }

  // ==========================================
  // UPDATE
  // ==========================================

  update() {

    if (!this.player) {
      return;
    }

    const speed = 200;

    // ----------------------------------------
    // MOVE LEFT
    // ----------------------------------------

    if (
      this.cursors.left.isDown
    ) {

      this.player.setVelocityX(
        -speed
      );

    }

    // ----------------------------------------
    // MOVE RIGHT
    // ----------------------------------------

    else if (
      this.cursors.right.isDown
    ) {

      this.player.setVelocityX(
        speed
      );

    }

    // ----------------------------------------
    // STOP
    // ----------------------------------------

    else {

      this.player.setVelocityX(
        0
      );
    }

    // ----------------------------------------
    // JUMP
    // ----------------------------------------

    if (
      this.cursors.up.isDown &&
      this.player.body &&
      (
        this.player.body as
        Phaser.Physics.Arcade.Body
      ).blocked.down
    ) {

      this.player.setVelocityY(
        -450
      );
    }

    // ----------------------------------------
    // SEND POSITION TO SERVER
    // ----------------------------------------

    if (this.room) {

      this.room.send(
        "move",
        {
          x: this.player.x,
          y: this.player.y
        }
      );
    }
  }
}