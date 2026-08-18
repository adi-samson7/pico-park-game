import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

// ==========================================
// PLAYER DATA
// ==========================================

interface PlayerData {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  playerIndex: number;
  color: number;
  ready: boolean;
}

// ==========================================
// GAME STATE
// ==========================================

interface Collectible {
  id: number;
  x: number;
  y: number;
  collected: boolean;
}

interface GameState {
  score: number;
  targetScore: number;
  collectibles?: Collectible[];
  gameStarted?: boolean;
  gameFinished?: boolean;
}

// ==========================================
// GAME SCENE
// ==========================================

export class GameScene extends Phaser.Scene {

  // ========================================
  // NETWORK
  // ========================================

  private room!: Room;

  // ========================================
  // PLAYERS
  // ========================================

  private localPlayer:
    Phaser.Physics.Arcade.Sprite | null =
    null;

  private remotePlayers:
    Map<
      string,
      Phaser.Physics.Arcade.Sprite
    > =
    new Map();

  private playerData:
    Map<string, PlayerData> =
    new Map();

  // ========================================
  // INPUT
  // ========================================

  private cursors!:
    Phaser.Types.Input.Keyboard.CursorKeys;

  private keys!: {
    A: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    W: Phaser.Input.Keyboard.Key;
  };

  // ========================================
  // WORLD
  // ========================================

  private ground!:
    Phaser.GameObjects.Rectangle;

  // ========================================
  // UI
  // ========================================

  private scoreText!:
    Phaser.GameObjects.Text;

  private statusText!:
    Phaser.GameObjects.Text;

  private gameOverText!:
    Phaser.GameObjects.Text;

  // ========================================
  // COLLECTIBLES
  // ========================================

  private collectibleSprites:
    Map<
      number,
      Phaser.GameObjects.Arc
    > =
    new Map();

  // ========================================
  // INPUT STATE
  // ========================================

  private lastInput = {
    left: false,
    right: false,
    jump: false
  };

  // ========================================
  // CONSTRUCTOR
  // ========================================

  constructor() {

    super({
      key: "GameScene"
    });
  }

  // ==========================================
  // INIT
  // ==========================================

  init(
    data: {
      room?: Room;
      players?: PlayerData[];
      myPlayer?: PlayerData;
    }
  ) {

    console.log(
      "================================"
    );

    console.log(
      "GameScene INIT"
    );

    console.log(
      "Received data:",
      data
    );

    console.log(
      "================================"
    );

    // ----------------------------------------
    // GET EXISTING ROOM
    // ----------------------------------------

    if (data.room) {

      this.room =
        data.room;

      console.log(
        "GameScene received existing room:",
        this.room.roomId
      );

      console.log(
        "GameScene session ID:",
        this.room.sessionId
      );
    }

    // ----------------------------------------
    // GET PLAYERS FROM LOBBY
    // ----------------------------------------

    if (data.players) {

      for (
        const player
        of data.players
      ) {

        this.playerData.set(
          player.id,
          player
        );
      }

      console.log(
        "GameScene received players:",
        data.players
      );
    }

    // ----------------------------------------
    // ENSURE OUR PLAYER EXISTS
    // ----------------------------------------

    if (data.myPlayer) {

      this.playerData.set(
        data.myPlayer.id,
        data.myPlayer
      );

      console.log(
        "GameScene received my player:",
        data.myPlayer
      );
    }
  }

  // ==========================================
  // CREATE
  // ==========================================

  create() {

    console.log(
      "Starting GameScene..."
    );

    // ----------------------------------------
    // SAFETY CHECK
    // ----------------------------------------

    if (!this.room) {

      console.error(
        "GameScene ERROR: No Colyseus room was provided."
      );

      this.add.text(
        400,
        300,
        "Game connection error",
        {
          fontSize: "32px",
          color: "#ff4444"
        }
      ).setOrigin(0.5);

      return;
    }

    // ----------------------------------------
    // WORLD
    // ----------------------------------------

    this.createWorld();

    // ----------------------------------------
    // INPUT
    // ----------------------------------------

    this.createInput();

    // ----------------------------------------
    // UI
    // ----------------------------------------

    this.createUI();

    // ----------------------------------------
    // CREATE ALL PLAYERS
    // ----------------------------------------

    this.createExistingPlayers();

    // ----------------------------------------
    // NETWORK LISTENERS
    // ----------------------------------------

    this.setupNetwork();

    console.log(
      "GameScene ready."
    );

    console.log(
      "Players currently in GameScene:",
      this.playerData.size
    );
  }

  // ==========================================
  // WORLD
  // ==========================================

  private createWorld() {

    this.cameras.main.setBackgroundColor(
      "#202020"
    );

    // ----------------------------------------
    // GROUND
    // ----------------------------------------

    this.ground =
      this.add.rectangle(
        400,
        570,
        800,
        60,
        0x333333
      );

    this.physics.add.existing(
      this.ground,
      true
    );

    console.log(
      "Game world created."
    );
  }

  // ==========================================
  // INPUT
  // ==========================================

  private createInput() {

    this.cursors =
      this.input.keyboard!.createCursorKeys();

    this.keys = {

      A:
        this.input.keyboard!.addKey(
          Phaser.Input.Keyboard.KeyCodes.A
        ),

      D:
        this.input.keyboard!.addKey(
          Phaser.Input.Keyboard.KeyCodes.D
        ),

      W:
        this.input.keyboard!.addKey(
          Phaser.Input.Keyboard.KeyCodes.W
        )
    };
  }

  // ==========================================
  // UI
  // ==========================================

  private createUI() {

    this.scoreText =
      this.add.text(
        20,
        20,
        "Crystals: 0 / 10",
        {
          fontSize: "24px",
          color: "#ffffff"
        }
      );

    this.statusText =
      this.add.text(
        400,
        20,
        "CO-OP GAME",
        {
          fontSize: "24px",
          color: "#ffffff"
        }
      ).setOrigin(0.5, 0);

    this.gameOverText =
      this.add.text(
        400,
        300,
        "",
        {
          fontSize: "48px",
          color: "#ffffff",
          align: "center"
        }
      ).setOrigin(0.5);

    this.gameOverText.setDepth(
      100
    );
  }

  // ==========================================
  // CREATE EXISTING PLAYERS
  // ==========================================

  private createExistingPlayers() {

    console.log(
      "Creating existing players..."
    );

    // ----------------------------------------
    // SORT BY PLAYER INDEX
    // ----------------------------------------

    const players =
      Array.from(
        this.playerData.values()
      ).sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      );

    // ----------------------------------------
    // CREATE EACH PLAYER
    // ----------------------------------------

    for (
      const player
      of players
    ) {

      console.log(
        "Creating player:",
        player
      );

      if (
        player.id ===
        this.room.sessionId
      ) {

        this.createLocalPlayer(
          player
        );

      } else {

        this.createRemotePlayer(
          player
        );
      }
    }

    console.log(
      "Local player:",
      this.localPlayer
    );

    console.log(
      "Remote players:",
      this.remotePlayers.size
    );
  }

  // ==========================================
  // NETWORK
  // ==========================================

  private setupNetwork() {

    // ========================================
    // PLAYER JOINED
    // ========================================

    this.room.onMessage(
      "playerJoined",
      (
        player: PlayerData
      ) => {

        console.log(
          "Player joined during game:",
          player
        );

        this.handlePlayer(
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

        const sprite =
          this.remotePlayers.get(
            player.id
          );

        if (!sprite) {

          console.warn(
            "Movement received for player that does not exist:",
            player.id
          );

          return;
        }

        // ------------------------------------
        // SMOOTH MOVEMENT
        // ------------------------------------

        this.tweens.add({

          targets:
            sprite,

          x:
            player.x,

          y:
            player.y,

          duration:
            50,

          ease:
            "Linear"
        });
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

        const sprite =
          this.remotePlayers.get(
            data.id
          );

        if (sprite) {

          sprite.destroy();
        }

        this.remotePlayers.delete(
          data.id
        );

        this.playerData.delete(
          data.id
        );
      }
    );

    // ========================================
    // GAME STATE
    // ========================================

    this.room.onMessage(
      "gameState",
      (
        state: GameState
      ) => {

        this.updateGameState(
          state
        );
      }
    );

    // ========================================
    // COLLECTIBLE
    // ========================================

    this.room.onMessage(
      "collectibleCollected",
      (
        data: {
          id: number;
          score: number;
        }
      ) => {

        const sprite =
          this.collectibleSprites.get(
            data.id
          );

        if (sprite) {

          sprite.destroy();

          this.collectibleSprites.delete(
            data.id
          );
        }

        this.scoreText.setText(
          `Crystals: ${data.score} / 10`
        );
      }
    );

    // ========================================
    // GAME ENDED
    // ========================================

    this.room.onMessage(
      "gameEnded",
      (
        data: {
          result: "win" | "lose";
          score: number;
          targetScore: number;
        }
      ) => {

        this.gameOverText.setText(
          data.result === "win"
            ? "YOU WIN!\n\nAll crystals collected!"
            : "YOU LOSE!"
        );

        this.statusText.setText(
          "GAME OVER"
        );
      }
    );
  }

  // ==========================================
  // HANDLE PLAYER
  // ==========================================

  private handlePlayer(
    player: PlayerData
  ) {

    // ----------------------------------------
    // STORE DATA
    // ----------------------------------------

    this.playerData.set(
      player.id,
      player
    );

    // ----------------------------------------
    // OUR PLAYER
    // ----------------------------------------

    if (
      player.id ===
      this.room.sessionId
    ) {

      if (!this.localPlayer) {

        this.createLocalPlayer(
          player
        );

      } else {

        this.localPlayer.setPosition(
          player.x,
          player.y
        );

        this.localPlayer.setTint(
          player.color
        );
      }

      return;
    }

    // ----------------------------------------
    // REMOTE PLAYER
    // ----------------------------------------

    if (
      !this.remotePlayers.has(
        player.id
      )
    ) {

      this.createRemotePlayer(
        player
      );
    }
  }

  // ==========================================
  // CREATE LOCAL PLAYER
  // ==========================================

  private createLocalPlayer(
    player: PlayerData
  ) {

    if (this.localPlayer) {

      this.localPlayer.setPosition(
        player.x,
        player.y
      );

      this.localPlayer.setTint(
        player.color
      );

      return;
    }

    const texture =
      this.createPlayerTexture(
        player.color
      );

    this.localPlayer =
      this.physics.add.sprite(
        player.x,
        player.y,
        texture
      );

    this.localPlayer.setTint(
      player.color
    );

    this.localPlayer.setCollideWorldBounds(
      true
    );

    this.physics.add.collider(
      this.localPlayer,
      this.ground
    );

    console.log(
      `Local player created: P${
        player.playerIndex + 1
      }`,
      player
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

    const texture =
      this.createPlayerTexture(
        player.color
      );

    const sprite =
      this.physics.add.sprite(
        player.x,
        player.y,
        texture
      );

    sprite.setTint(
      player.color
    );

    sprite.setCollideWorldBounds(
      true
    );

    this.physics.add.collider(
      sprite,
      this.ground
    );

    this.remotePlayers.set(
      player.id,
      sprite
    );

    console.log(
      `Remote player created: P${
        player.playerIndex + 1
      }`,
      player
    );
  }

  // ==========================================
  // CREATE PLAYER TEXTURE
  // ==========================================

  private createPlayerTexture(
    color: number
  ): string {

    const key =
      `player_${color}`;

    // ----------------------------------------
    // DON'T CREATE DUPLICATE TEXTURE
    // ----------------------------------------

    if (
      this.textures.exists(key)
    ) {

      return key;
    }

    const graphics =
      this.add.graphics();

    graphics.fillStyle(
      color,
      1
    );

    graphics.fillRect(
      0,
      0,
      40,
      60
    );

    graphics.generateTexture(
      key,
      40,
      60
    );

    graphics.destroy();

    return key;
  }

  // ==========================================
  // GAME STATE
  // ==========================================

  private updateGameState(
    state: GameState
  ) {

    this.scoreText.setText(
      `Crystals: ${
        state.score
      } / ${
        state.targetScore ?? 10
      }`
    );

    if (
      state.collectibles
    ) {

      this.createCollectibles(
        state.collectibles
      );
    }
  }

  // ==========================================
  // CREATE COLLECTIBLES
  // ==========================================

  private createCollectibles(
    collectibles: Collectible[]
  ) {

    for (
      const collectible
      of collectibles
    ) {

      if (
        collectible.collected
      ) {

        continue;
      }

      if (
        this.collectibleSprites.has(
          collectible.id
        )
      ) {

        continue;
      }

      const crystal =
        this.add.circle(
          collectible.x,
          collectible.y,
          12,
          0x66ddff
        );

      this.collectibleSprites.set(
        collectible.id,
        crystal
      );
    }
  }

  // ==========================================
  // UPDATE
  // ==========================================

  update() {

    if (
      !this.localPlayer ||
      !this.room
    ) {

      return;
    }

    // ========================================
    // INPUT
    // ========================================

    const left =
      this.cursors.left.isDown ||
      this.keys.A.isDown;

    const right =
      this.cursors.right.isDown ||
      this.keys.D.isDown;

    const jump =
      this.cursors.up.isDown ||
      this.keys.W.isDown;

    const input = {

      left,
      right,
      jump
    };

    // ========================================
    // SEND INPUT WHEN CHANGED
    // ========================================

    const changed =
      left !== this.lastInput.left ||
      right !== this.lastInput.right ||
      jump !== this.lastInput.jump;

    if (changed) {

      this.room.send(
        "input",
        input
      );

      this.lastInput = {
        left,
        right,
        jump
      };
    }

    // ========================================
    // CONTINUOUS MOVEMENT
    // ========================================

    if (
      left ||
      right
    ) {

      this.room.send(
        "input",
        input
      );
    }

    // ========================================
    // RELEASE JUMP
    // ========================================

    if (
      !jump &&
      this.lastInput.jump
    ) {

      this.room.send(
        "input",
        {
          left,
          right,
          jump: false
        }
      );

      this.lastInput.jump =
        false;
    }
  }
}