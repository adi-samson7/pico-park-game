import Phaser from "phaser";
import { Client, Room } from "@colyseus/sdk";
import "./style.css";

interface PlayerData {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
}

interface RemotePlayer {
  id: string;
  sprite: Phaser.Physics.Arcade.Sprite;
}

class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private room!: Room;

  private remotePlayers: Map<string, RemotePlayer> =
    new Map();

  constructor() {
    super("GameScene");
  }

  async create() {
    this.createPlayerTexture();

    this.createWorld();

    this.cursors =
      this.input.keyboard!.createCursorKeys();

    await this.connectToServer();
  }

  private createPlayerTexture() {
    const graphics = this.add.graphics();

    graphics.fillStyle(0xffffff, 1);

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

  private createWorld() {
    // Temporary local player.
    // We will make the server control this
    // spawn position in the next step.
    this.player =
      this.physics.add.sprite(
        250,
        300,
        "player"
      );

    this.player.setTint(0xff4444);

    this.player.setCollideWorldBounds(
      true
    );

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

  private async connectToServer() {
    try {
      const client =
        new Client(
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

  private setupRoomListeners() {

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
  }

  private createRemotePlayer(
    player: PlayerData
  ) {

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

    // Use the color assigned by server
    sprite.setTint(
      player.color
    );

    sprite.setCollideWorldBounds(
      true
    );

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

    this.remotePlayers.set(
      player.id,
      {
        id: player.id,
        sprite: sprite
      }
    );
  }

  update() {

    if (!this.player) {
      return;
    }

    const speed = 200;

    // LEFT
    if (
      this.cursors.left.isDown
    ) {

      this.player.setVelocityX(
        -speed
      );

    }

    // RIGHT
    else if (
      this.cursors.right.isDown
    ) {

      this.player.setVelocityX(
        speed
      );

    }

    // STOP
    else {

      this.player.setVelocityX(
        0
      );
    }

    // JUMP
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

    // Send player position
    // to the server.
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

// ==========================================
// PHASER CONFIGURATION
// ==========================================

const config:
  Phaser.Types.Core.GameConfig = {

  type: Phaser.AUTO,

  width: 800,

  height: 600,

  backgroundColor: "#202020",

  physics: {

    default: "arcade",

    arcade: {

      gravity: {
        x: 0,
        y: 1000
      },

      debug: false
    }
  },

  scene: GameScene
};

// ==========================================
// START GAME
// ==========================================

new Phaser.Game(config);