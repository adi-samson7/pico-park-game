import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

// ==========================================
// TYPES
// ==========================================

interface PlayerData {

  id: string;

  x: number;
  y: number;

  playerIndex: number;

  color: number;

  ready: boolean;

  velocityX?: number;
  velocityY?: number;

  alive?: boolean;

  jumpCount?: number;
  grounded?: boolean;
}

interface PlatformData {

  x: number;
  y: number;

  width: number;
  height: number;
}

interface CrystalData {

  id: number;

  x: number;
  y: number;

  collected: boolean;
}

// Sent once per level (and on request).
interface LevelData {

  level: number;

  maxLevels: number;

  targetScore: number;

  score: number;

  platforms: PlatformData[];

  crystals: CrystalData[];

  exit: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  doorOpen: boolean;
}

// Sent every server tick.
interface GameState {

  players: PlayerData[];

  score: number;

  targetScore: number;

  level: number;

  maxLevels: number;

  gameStarted: boolean;

  gameFinished: boolean;

  doorOpen: boolean;

  playersAtExit: number;
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

    A:
      Phaser.Input.Keyboard.Key;

    D:
      Phaser.Input.Keyboard.Key;

    W:
      Phaser.Input.Keyboard.Key;

    SPACE:
      Phaser.Input.Keyboard.Key;

    ENTER:
      Phaser.Input.Keyboard.Key;
  };

  // ========================================
  // WORLD
  // ========================================

  private ground!:
    Phaser.GameObjects.Rectangle;

  private platformObjects:
    Phaser.GameObjects.Rectangle[] =
    [];

  // ========================================
  // CRYSTALS
  // ========================================

  private crystalSprites:
    Map<
      number,
      Phaser.GameObjects.Arc
    > =
    new Map();

  // ========================================
  // UI
  // ========================================

  private scoreText!:
    Phaser.GameObjects.Text;

  private levelText!:
    Phaser.GameObjects.Text;

  private statusText!:
    Phaser.GameObjects.Text;

  private messageText!:
    Phaser.GameObjects.Text;

  private hintText!:
    Phaser.GameObjects.Text;

  private objectiveText!:
    Phaser.GameObjects.Text;

  // Exit door (rebuilt for every level).
  private doorRect:
    Phaser.GameObjects.Rectangle | null =
    null;

  private doorLabel:
    Phaser.GameObjects.Text | null =
    null;

  private doorOpen = false;

  private youMarker!:
    Phaser.GameObjects.Text;

  // One coloured chip per connected player.
  private playerChips:
    Phaser.GameObjects.Rectangle[] =
    [];

  private chipSignature = "";

  // ========================================
  // LEVEL / STATE
  // ========================================

  private targetScore = 10;

  private gameFinished = false;

  private leaving = false;

  // ========================================
  // INIT
  // ========================================

  constructor() {

    super({
      key:
        "GameScene"
    });
  }

  // ========================================
  // SCENE INIT
  // ========================================

  init(
    data: {
      room?: Room;

      players?: PlayerData[];

      myPlayer?: PlayerData;
    }
  ) {

    console.log(
      "GameScene received:",
      data
    );

    // The scene instance is reused between
    // games, so start from a clean slate.

    this.localPlayer = null;
    this.remotePlayers = new Map();
    this.playerData = new Map();
    this.platformObjects = [];
    this.crystalSprites = new Map();
    this.playerChips = [];
    this.chipSignature = "";
    this.targetScore = 10;
    this.gameFinished = false;
    this.leaving = false;
    this.doorRect = null;
    this.doorLabel = null;
    this.doorOpen = false;

    if (
      data.room
    ) {

      this.room =
        data.room;
    }

    if (
      data.players
    ) {

      for (
        const player
        of data.players
      ) {

        this.playerData.set(
          player.id,
          player
        );
      }
    }

    if (
      data.myPlayer
    ) {

      this.playerData.set(
        data.myPlayer.id,
        data.myPlayer
      );
    }
  }

  // ========================================
  // CREATE
  // ========================================

  create() {

    if (
      !this.room
    ) {

      console.error(
        "GameScene: room missing."
      );

      return;
    }

    this.cameras.main.setBackgroundColor(
      "#202020"
    );

    this.createInput();

    this.createUI();

    this.createGround();

    this.createInitialPlayers();

    this.setupNetwork();

    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      this.shutdown,
      this
    );

    // Level geometry is not part of the
    // per-tick state: ask for it now that
    // our listeners exist.

    this.room.send(
      "requestLevel"
    );

    console.log(
      "GameScene started."
    );
  }

  // ========================================
  // INPUT
  // ========================================

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
        ),

      SPACE:
        this.input.keyboard!.addKey(
          Phaser.Input.Keyboard.KeyCodes.SPACE
        ),

      ENTER:
        this.input.keyboard!.addKey(
          Phaser.Input.Keyboard.KeyCodes.ENTER
        )
    };
  }

  // ========================================
  // UI
  // ========================================

  private createUI() {

    this.scoreText =
      this.add.text(
        20,
        18,
        "Crystals: 0 / 10",
        {
          fontSize:
            "24px",

          color:
            "#ffffff"
        }
      );

    this.levelText =
      this.add.text(
        400,
        18,
        "LEVEL 1 / 3",
        {
          fontSize:
            "24px",

          color:
            "#ffffff"
        }
      ).setOrigin(
        0.5,
        0
      );

    this.objectiveText =
      this.add.text(
        400,
        50,
        "Collect all the crystals",
        {
          fontSize:
            "16px",

          color:
            "#ffdd66"
        }
      ).setOrigin(
        0.5,
        0
      );

    this.statusText =
      this.add.text(
        780,
        18,
        "CO-OP",
        {
          fontSize:
            "20px",

          color:
            "#aaaaaa"
        }
      ).setOrigin(
        1,
        0
      );

    this.messageText =
      this.add.text(
        400,
        300,
        "",
        {
          fontSize:
            "42px",

          color:
            "#ffffff",

          align:
            "center",

          stroke:
            "#000000",

          strokeThickness:
            5
        }
      ).setOrigin(
        0.5
      );

    this.messageText.setDepth(
      100
    );

    this.hintText =
      this.add.text(
        400,
        572,
        "A / D or ← / → move   |   SPACE jump (press again in the air to double jump)   |   stand on each other!",
        {
          fontSize:
            "13px",

          color:
            "#999999"
        }
      ).setOrigin(
        0.5
      );

    this.hintText.setDepth(
      50
    );

    this.youMarker =
      this.add.text(
        0,
        0,
        "▼ YOU",
        {
          fontSize:
            "12px",

          color:
            "#ffffff"
        }
      ).setOrigin(
        0.5,
        1
      );

    this.youMarker.setDepth(
      20
    );

    this.youMarker.setVisible(
      false
    );
  }

  // ========================================
  // GROUND
  // ========================================

  private createGround() {

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
  }

  // ========================================
  // INITIAL PLAYERS
  // ========================================

  private createInitialPlayers() {

    const players =
      Array.from(
        this.playerData.values()
      );

    players.sort(
      (a, b) =>
        a.playerIndex -
        b.playerIndex
    );

    for (
      const player
      of players
    ) {

      this.createPlayer(
        player
      );
    }
  }

  // ========================================
  // CREATE PLAYER
  // ========================================

  private createPlayer(
    player: PlayerData
  ) {

    // --------------------------------------
    // LOCAL
    // --------------------------------------

    if (
      player.id ===
      this.room.sessionId
    ) {

      if (
        this.localPlayer
      ) {
        return;
      }

      this.localPlayer =
        this.physics.add.sprite(
          player.x,
          player.y,
          this.createPlayerTexture(
            player.color
          )
        );

      this.configurePlayerSprite(
        this.localPlayer
      );

      console.log(
        "LOCAL PLAYER:",
        player.playerIndex + 1
      );

      return;
    }

    // --------------------------------------
    // REMOTE
    // --------------------------------------

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
        this.createPlayerTexture(
          player.color
        )
      );

    this.configurePlayerSprite(
      sprite
    );

    this.remotePlayers.set(
      player.id,
      sprite
    );

    console.log(
      "REMOTE PLAYER:",
      player.playerIndex + 1
    );
  }

  // ========================================
  // CONFIGURE PLAYER
  // ========================================

  private configurePlayerSprite(
    sprite:
      Phaser.Physics.Arcade.Sprite
  ) {

    sprite.setCollideWorldBounds(
      false
    );

    const body =
      sprite.body as
        Phaser.Physics.Arcade.Body;

    // The server is authoritative.
    // Do not let Phaser apply another
    // gravity simulation locally.

    body.allowGravity =
      false;

    body.immovable =
      true;

    body.moves =
      false;

    body.setSize(
      40,
      60
    );
  }

  // ========================================
  // TEXTURE
  // ========================================

  private createPlayerTexture(
    color: number
  ): string {

    const key =
      `player_${color}`;

    if (
      this.textures.exists(
        key
      )
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

  // ========================================
  // NETWORK
  // ========================================

  private setupNetwork() {

    // --------------------------------------
    // GAME STATE
    // --------------------------------------

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

    // --------------------------------------
    // CRYSTAL COLLECTED
    // --------------------------------------

    this.room.onMessage(
      "crystalCollected",
      (
        data: {
          id: number;
          score: number;
        }
      ) => {

        this.removeCrystal(
          data.id
        );

        this.scoreText.setText(
          `Crystals: ${
            data.score
          } / ${
            this.targetScore
          }`
        );
      }
    );

    // --------------------------------------
    // DOOR OPENED
    // --------------------------------------

    this.room.onMessage(
      "doorOpened",
      () => {

        this.setDoorOpen(
          true
        );

        this.showTemporaryMessage(
          "EXIT OPEN!\nEveryone get to the door",
          1600
        );
      }
    );

    // --------------------------------------
    // LEVEL LOADED (geometry + crystals)
    // --------------------------------------

    this.room.onMessage(
      "levelLoaded",
      (
        data: LevelData
      ) => {

        this.applyLevel(
          data
        );
      }
    );

    // --------------------------------------
    // LEVEL COMPLETE
    // --------------------------------------

    this.room.onMessage(
      "levelCompleted",
      (
        data: {
          completedLevel: number;
          nextLevel: number;
        }
      ) => {

        this.showTemporaryMessage(
          `LEVEL ${
            data.completedLevel
          } COMPLETE!`,
          1200
        );
      }
    );

    // --------------------------------------
    // RESPAWN
    // --------------------------------------

    this.room.onMessage(
      "playerRespawned",
      (
        data: {
          id: string;
          x: number;
          y: number;
        }
      ) => {

        this.respawnVisual(
          data
        );
      }
    );

    // --------------------------------------
    // GAME FINISHED
    // --------------------------------------

    this.room.onMessage(
      "gameFinished",
      () => {

        this.gameFinished =
          true;

        this.messageText.setText(
          "YOU WIN!\n\nALL LEVELS COMPLETE\n\nPress ENTER to return to the menu"
        );

        this.statusText.setText(
          "GAME COMPLETE"
        );

        this.statusText.setColor(
          "#66ff66"
        );
      }
    );

    // --------------------------------------
    // PLAYER JOINED
    // --------------------------------------

    this.room.onMessage(
      "playerJoined",
      (
        player: PlayerData
      ) => {

        this.playerData.set(
          player.id,
          player
        );

        this.createPlayer(
          player
        );
      }
    );

    // --------------------------------------
    // PLAYER LEFT
    // --------------------------------------

    this.room.onMessage(
      "playerLeft",
      (
        data: {
          id: string;
        }
      ) => {

        const sprite =
          this.remotePlayers.get(
            data.id
          );

        if (
          sprite
        ) {

          sprite.destroy();
        }

        this.remotePlayers.delete(
          data.id
        );

        this.playerData.delete(
          data.id
        );

        this.updatePlayerHud();
      }
    );

    // --------------------------------------
    // CONNECTION LOST
    // --------------------------------------

    this.room.onLeave(
      () => {

        this.returnToMenu(
          false
        );
      }
    );
  }

  // ========================================
  // RETURN TO MENU
  // ========================================

  private returnToMenu(
    leaveRoom: boolean
  ) {

    if (this.leaving) {
      return;
    }

    this.leaving = true;

    if (leaveRoom) {

      this.room.leave()
        .catch(() => {});
    }

    this.scene.start(
      "MenuScene"
    );
  }

  // ========================================
  // GAME STATE
  // ========================================

  private updateGameState(
    state: GameState
  ) {

    this.targetScore =
      state.targetScore;

    this.scoreText.setText(
      `Crystals: ${
        state.score
      } / ${
        state.targetScore
      }`
    );

    this.levelText.setText(
      `LEVEL ${
        state.level
      } / ${
        state.maxLevels
      }`
    );

    // --------------------------------------
    // PLAYERS
    // --------------------------------------

    for (
      const player
      of state.players
    ) {

      this.playerData.set(
        player.id,
        player
      );

      // ------------------------------------
      // LOCAL
      // ------------------------------------

      if (
        player.id ===
        this.room.sessionId
      ) {

        if (
          !this.localPlayer
        ) {

          this.createPlayer(
            player
          );
        }

        if (
          this.localPlayer
        ) {

          this.localPlayer.setPosition(
            player.x,
            player.y
          );
        }

        continue;
      }

      // ------------------------------------
      // REMOTE
      // ------------------------------------

      let sprite =
        this.remotePlayers.get(
          player.id
        );

      if (!sprite) {

        this.createPlayer(
          player
        );

        sprite =
          this.remotePlayers.get(
            player.id
          );
      }

      if (
        sprite
      ) {

        sprite.setPosition(
          player.x,
          player.y
        );

        sprite.setVisible(
          player.alive !== false
        );
      }
    }

    if (
      state.doorOpen &&
      this.doorLabel
    ) {

      this.doorLabel.setText(
        `EXIT ${
          state.playersAtExit
        }/${
          state.players.length
        }`
      );
    }

    this.updatePlayerHud();
  }

  // ========================================
  // EXIT DOOR
  // ========================================

  private buildDoor(
    exit: LevelData["exit"]
  ) {

    this.doorRect?.destroy();

    this.doorLabel?.destroy();

    this.doorRect =
      this.add.rectangle(
        exit.x,
        exit.y,
        exit.width,
        exit.height,
        0x552222
      );

    this.doorRect.setStrokeStyle(
      3,
      0xff6666
    );

    this.doorRect.setDepth(
      0.5
    );

    this.doorLabel =
      this.add.text(
        exit.x,
        exit.y -
          exit.height / 2 -
          6,
        "LOCKED",
        {
          fontSize:
            "14px",

          color:
            "#ff9999"
        }
      ).setOrigin(
        0.5,
        1
      );

    this.doorLabel.setDepth(
      0.5
    );
  }

  private setDoorOpen(
    open: boolean
  ) {

    this.doorOpen =
      open;

    this.doorRect?.setFillStyle(
      open
        ? 0x226633
        : 0x552222
    );

    this.doorRect?.setStrokeStyle(
      3,
      open
        ? 0x66ff88
        : 0xff6666
    );

    this.doorLabel?.setText(
      open
        ? "EXIT"
        : "LOCKED"
    );

    this.doorLabel?.setColor(
      open
        ? "#88ffaa"
        : "#ff9999"
    );

    this.objectiveText.setText(
      open
        ? "Everyone to the exit door!"
        : "Collect all the crystals"
    );
  }

  // ========================================
  // LEVEL
  // ========================================

  private applyLevel(
    data: LevelData
  ) {

    this.targetScore =
      data.targetScore;

    this.levelText.setText(
      `LEVEL ${
        data.level
      } / ${
        data.maxLevels
      }`
    );

    this.scoreText.setText(
      `Crystals: ${
        data.score
      } / ${
        data.targetScore
      }`
    );

    // Drop the previous level's crystals
    // immediately (no collect animation).

    for (
      const crystal
      of this.crystalSprites.values()
    ) {

      crystal.destroy();
    }

    this.crystalSprites.clear();

    this.updatePlatforms(
      data.platforms
    );

    this.updateCrystals(
      data.crystals
    );

    this.buildDoor(
      data.exit
    );

    this.setDoorOpen(
      data.doorOpen
    );
  }

  // ========================================
  // PLAYER HUD
  // ========================================

  private updatePlayerHud() {

    const players =
      Array.from(
        this.playerData.values()
      ).sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      );

    // Only rebuild when the roster changes.

    const signature =
      players.map(
        player =>
          player.id
      ).join(
        ","
      );

    if (
      signature ===
      this.chipSignature
    ) {
      return;
    }

    this.chipSignature =
      signature;

    for (
      const chip
      of this.playerChips
    ) {

      chip.destroy();
    }

    this.playerChips =
      [];

    this.statusText.setText(
      `PLAYERS ${
        players.length
      } / 4`
    );

    players.forEach(
      (player, index) => {

        const chip =
          this.add.rectangle(
            780 - index * 24,
            54,
            16,
            16,
            player.color
          ).setOrigin(
            1,
            0
          );

        if (
          player.id ===
          this.room.sessionId
        ) {

          chip.setStrokeStyle(
            2,
            0xffffff
          );
        }

        chip.setDepth(
          10
        );

        this.playerChips.push(
          chip
        );
      }
    );
  }

  // ========================================
  // PLATFORMS
  // ========================================

  private updatePlatforms(
    platforms: PlatformData[]
  ) {

    for (
      const platform
      of this.platformObjects
    ) {

      platform.destroy();
    }

    this.platformObjects =
      [];

    for (
      const platform
      of platforms
    ) {

      const object =
        this.add.rectangle(
          platform.x,
          platform.y,
          platform.width,
          platform.height,
          0x555555
        );

      object.setDepth(
        1
      );

      this.platformObjects.push(
        object
      );
    }
  }

  // ========================================
  // CRYSTALS
  // ========================================

  private updateCrystals(
    crystals: CrystalData[]
  ) {

    for (
      const crystal
      of crystals
    ) {

      if (
        crystal.collected
      ) {

        this.removeCrystal(
          crystal.id
        );

        continue;
      }

      if (
        this.crystalSprites.has(
          crystal.id
        )
      ) {

        continue;
      }

      const sprite =
        this.add.circle(
          crystal.x,
          crystal.y,
          10,
          0x66ddff
        );

      sprite.setStrokeStyle(
        2,
        0xffffff
      );

      sprite.setDepth(
        5
      );

      this.crystalSprites.set(
        crystal.id,
        sprite
      );
    }
  }

  // ========================================
  // REMOVE CRYSTAL
  // ========================================

  private removeCrystal(
    id: number
  ) {

    const crystal =
      this.crystalSprites.get(
        id
      );

    if (!crystal) {
      return;
    }

    this.tweens.add({

      targets:
        crystal,

      scale:
        1.8,

      alpha:
        0,

      duration:
        150,

      onComplete:
        () => {

          crystal.destroy();

          this.crystalSprites.delete(
            id
          );
        }
    });
  }

  // ========================================
  // RESPAWN
  // ========================================

  private respawnVisual(
    data: {
      id: string;
      x: number;
      y: number;
    }
  ) {

    if (
      data.id ===
      this.room.sessionId
    ) {

      if (
        this.localPlayer
      ) {

        this.localPlayer.setPosition(
          data.x,
          data.y
        );
      }

      this.showTemporaryMessage(
        "RESPAWN!",
        700
      );

      return;
    }

    const sprite =
      this.remotePlayers.get(
        data.id
      );

    if (
      sprite
    ) {

      sprite.setPosition(
        data.x,
        data.y
      );
    }
  }

  // ========================================
  // MESSAGE
  // ========================================

  private showTemporaryMessage(
    message: string,
    duration: number
  ) {

    this.messageText.setText(
      message
    );

    this.messageText.setAlpha(
      1
    );

    this.tweens.add({

      targets:
        this.messageText,

      alpha:
        0,

      duration,

      onComplete:
        () => {

          this.messageText.setAlpha(
            1
          );

          this.messageText.setText(
            ""
          );
        }
    });
  }

  // ========================================
  // UPDATE
  // ========================================

  update() {

    if (
      !this.room ||
      !this.localPlayer
    ) {

      return;
    }

    const left =
      this.cursors.left.isDown ||
      this.keys.A.isDown;

    const right =
      this.cursors.right.isDown ||
      this.keys.D.isDown;

    // IMPORTANT:
    // JustDown means one jump event
    // per key press.
    //
    // The server decides whether it
    // is jump #1 or jump #2.

    const jump =
      Phaser.Input.Keyboard.JustDown(
        this.keys.SPACE
      ) ||
      Phaser.Input.Keyboard.JustDown(
        this.cursors.up
      ) ||
      Phaser.Input.Keyboard.JustDown(
        this.keys.W
      );

    this.youMarker.setPosition(
      this.localPlayer.x,
      this.localPlayer.y - 36
    );

    this.youMarker.setVisible(
      true
    );

    if (this.gameFinished) {

      if (
        Phaser.Input.Keyboard.JustDown(
          this.keys.ENTER
        )
      ) {

        this.returnToMenu(
          true
        );
      }

      return;
    }

    this.room.send(
      "input",
      {
        left,

        right,

        jump
      }
    );
  }

  // ========================================
  // SHUTDOWN
  // ========================================

  shutdown() {

    console.log(
      "GameScene shutting down."
    );

    for (
      const sprite
      of this.remotePlayers.values()
    ) {

      sprite.destroy();
    }

    this.remotePlayers.clear();

    for (
      const crystal
      of this.crystalSprites.values()
    ) {

      crystal.destroy();
    }

    this.crystalSprites.clear();

    for (
      const platform
      of this.platformObjects
    ) {

      platform.destroy();
    }

    this.platformObjects =
      [];

    for (
      const chip
      of this.playerChips
    ) {

      chip.destroy();
    }

    this.playerChips =
      [];

    this.doorRect?.destroy();

    this.doorLabel?.destroy();

    this.doorRect = null;

    this.doorLabel = null;
  }
}