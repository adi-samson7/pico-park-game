import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

import { audio } from "../audio/AudioManager";

import { ConnectionHud } from "../net/ConnectionHud";

import {
  Predictor,
  type NetPlayer
} from "../net/prediction";

import { qualityOf, QUALITY_COLORS } from "../net/latency";

import { NET_SETTINGS } from "../net/settings";

import { SnapshotBuffer } from "../net/snapshots";

import { tabSession } from "../net/session";

import { formatTime } from "../format";

import {
  addMuteButton,
  burst,
  confettiBurst,
  confettiRain,
  ensureParticleTexture,
  ensurePlayerTexture,
  floatText
} from "../effects";

// ==========================================
// TYPES
// ==========================================

interface PlayerData {

  id: string;

  x: number;
  y: number;

  playerIndex: number;

  // Chosen by the player (cleaned by the server).
  name?: string;

  color: number;

  ready: boolean;

  velocityX?: number;
  velocityY?: number;

  alive?: boolean;

  jumpCount?: number;
  grounded?: boolean;

  standingOn?: string | null;

  // False while the player's connection is
  // down and the server holds their seat.
  connected?: boolean;

  // Last input number the server applied.
  ack?: number;
}

// "intro": LEVEL N is shown, "clear": LEVEL
// CLEAR is shown (both: nobody can move),
// "playing": the level is on.
type LevelPhase = "intro" | "playing" | "clear";

// Everything needed to rebuild a client's
// picture after it missed messages.
interface ResyncData {

  roomCode: string;

  hostId: string;

  gameStarted: boolean;

  gameFinished: boolean;

  players: PlayerData[];

  level: LevelData | null;

  phase?: LevelPhase;

  phaseMsLeft?: number;
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

// Per-player animation state. The server
// is authoritative: the sprite eases
// towards (tx, ty) and effects are driven
// by changes in the state it sends.
interface PlayerFx {

  // Target feet position.
  tx: number;
  ty: number;

  // Squash & stretch multipliers.
  sqX: number;
  sqY: number;

  facing: 1 | -1;

  vx: number;

  grounded: boolean;

  jumpCount: number;

  // Last downward speed seen in the air.
  airVy: number;

  // Walk-cycle phase and dust timer.
  phase: number;
  dust: number;

  // Desync idle breathing between players.
  seed: number;

  color: number;

  isLocal: boolean;
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

  // Gaps in the ground (x1..x2).
  pits: { x1: number; x2: number }[];

  // Spike strips: x = centre, y = surface.
  spikes: { x: number; y: number; width: number }[];

  spikeHeight: number;
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

  // How many players the door waits for.
  playersNeeded?: number;

  phase?: LevelPhase;

  // Time the level has been played (ms).
  levelElapsedMs?: number;
}

// ==========================================
// GAME SCENE
// ==========================================

export class GameScene extends Phaser.Scene {

  // ========================================
  // NETWORK
  // ========================================

  private room!: Room;

  // Ping chip, "connection lost" veil.
  private hud: ConnectionHud | null = null;

  // ========================================
  // LEVEL SCREENS
  // ========================================
  //
  // "LEVEL CLEAR" and "LEVEL N" are driven by
  // the server (which also holds everyone
  // still): the scene only mirrors its phase.

  private phase: LevelPhase = "playing";

  private bannerVeil:
    Phaser.GameObjects.Rectangle | null =
    null;

  private bannerTitle:
    Phaser.GameObjects.Text | null =
    null;

  private bannerSub:
    Phaser.GameObjects.Text | null =
    null;

  private bannerVisible = false;

  // Runs the shared physics on the local
  // player for instant response (see
  // net/prediction.ts).
  private predictor: Predictor | null = null;

  // Recent positions of every OTHER player,
  // drawn slightly in the past so network
  // jitter does not show (net/snapshots.ts).
  private snapshots:
    Map<string, SnapshotBuffer> =
    new Map();

  // The player's name, floating above them.
  private nameLabels:
    Map<
      string,
      Phaser.GameObjects.Text
    > =
    new Map();

  // "connection lost" tag above an absent
  // player.
  private ghostLabels:
    Map<
      string,
      Phaser.GameObjects.Text
    > =
    new Map();

  // Small ping numbers under the player chips.
  private latencyLabels:
    Phaser.GameObjects.Text[] = [];

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

  private playerFx:
    Map<string, PlayerFx> =
    new Map();

  // Level number currently shown (for the
  // transition between levels).
  private shownLevel = 0;

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

  // Ground segments + pit voids (rebuilt
  // for every level).
  private groundObjects:
    Phaser.GameObjects.GameObject[] =
    [];

  // Spike strips (rebuilt for every level).
  private hazardObjects:
    Phaser.GameObjects.GameObject[] =
    [];

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
    this.groundObjects = [];
    this.hazardObjects = [];
    this.playerFx = new Map();
    this.shownLevel = 0;
    this.hud = null;
    this.phase = "playing";
    this.bannerVeil = null;
    this.bannerTitle = null;
    this.bannerSub = null;
    this.bannerVisible = false;
    this.predictor = null;
    this.snapshots = new Map();
    this.ghostLabels = new Map();
    this.nameLabels = new Map();
    this.latencyLabels = [];

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

    ensureParticleTexture(
      this
    );

    this.createInput();

    this.createUI();

    this.createBanner();

    this.createGround();

    this.createInitialPlayers();

    this.setupNetwork();

    this.predictor =
      new Predictor(
        this.room.sessionId
      );

    this.hud =
      new ConnectionHud(
        this,
        this.room,
        {
          x: 790,
          y: 592,

          onLost: (code) =>
            this.connectionLost(code),

          onRestored: () =>
            this.afterReconnect(),

          onLatencies: () =>
            this.refreshLatencyLabels()
        }
      );

    addMuteButton(
      this,
      20,
      76
    );

    audio.playMusic(
      "game"
    );

    this.cameras.main.fadeIn(
      350
    );

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
        "A/D or ←/→ move  |  SPACE jump (twice = double jump)  |  stack up  |  avoid spikes & pits",
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

    // Solid until the level data arrives.

    this.buildGround(
      []
    );
  }

  // Solid ground everywhere except the pits.

  private buildGround(
    pits: LevelData["pits"]
  ) {

    for (
      const object
      of this.groundObjects
    ) {

      object.destroy();
    }

    this.groundObjects =
      [];

    const sorted =
      [...pits].sort(
        (a, b) =>
          a.x1 - b.x1
      );

    let cursor = 0;

    const addSolid = (
      from: number,
      to: number
    ) => {

      if (to <= from) {
        return;
      }

      this.groundObjects.push(
        this.add.rectangle(
          (from + to) / 2,
          570,
          to - from,
          60,
          0x333333
        )
      );
    };

    for (const pit of sorted) {

      addSolid(
        cursor,
        pit.x1
      );

      // The void: darker, with a red edge
      // so the danger is obvious.

      const hole =
        this.add.rectangle(
          (pit.x1 + pit.x2) / 2,
          570,
          pit.x2 - pit.x1,
          60,
          0x110505
        );

      hole.setStrokeStyle(
        2,
        0x662222
      );

      this.groundObjects.push(
        hole
      );

      cursor =
        pit.x2;
    }

    addSolid(
      cursor,
      800
    );
  }

  // ========================================
  // SPIKES
  // ========================================

  private buildSpikes(
    spikes: LevelData["spikes"],
    height: number
  ) {

    for (
      const object
      of this.hazardObjects
    ) {

      object.destroy();
    }

    this.hazardObjects =
      [];

    const TOOTH = 10;

    for (const strip of spikes) {

      const graphics =
        this.add.graphics();

      graphics.fillStyle(
        0xdddddd,
        1
      );

      graphics.lineStyle(
        1,
        0xff4444,
        1
      );

      const left =
        strip.x -
        strip.width / 2;

      const teeth =
        Math.max(
          1,
          Math.round(
            strip.width / TOOTH
          )
        );

      const width =
        strip.width / teeth;

      for (
        let i = 0;
        i < teeth;
        i++
      ) {

        const x0 =
          left + i * width;

        graphics.fillTriangle(
          x0,
          strip.y,
          x0 + width,
          strip.y,
          x0 + width / 2,
          strip.y - height
        );

        graphics.strokeTriangle(
          x0,
          strip.y,
          x0 + width,
          strip.y,
          x0 + width / 2,
          strip.y - height
        );
      }

      graphics.setDepth(
        3
      );

      this.hazardObjects.push(
        graphics
      );
    }
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

      this.registerFx(
        player,
        this.localPlayer,
        true
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

    this.registerFx(
      player,
      sprite,
      false
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

    // Anchor at the feet so squash and
    // stretch keep the player planted.
    sprite.setOrigin(
      0.5,
      1
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

    return ensurePlayerTexture(
      this,
      color
    );
  }

  // ========================================
  // PLAYER FX
  // ========================================

  private registerFx(
    player: PlayerData,
    sprite:
      Phaser.Physics.Arcade.Sprite,
    isLocal: boolean
  ) {

    const fx: PlayerFx = {

      tx:
        player.x,

      ty:
        player.y + 30,

      sqX:
        0.2,

      sqY:
        0.2,

      facing:
        1,

      vx:
        0,

      grounded:
        false,

      jumpCount:
        0,

      airVy:
        0,

      phase:
        0,

      dust:
        0,

      seed:
        Math.random() * 6.28,

      color:
        player.color,

      isLocal
    };

    this.playerFx.set(
      player.id,
      fx
    );

    sprite.setPosition(
      fx.tx,
      fx.ty
    );

    // Pop in.

    this.tweens.add({

      targets:
        fx,

      sqX:
        1,

      sqY:
        1,

      duration:
        320,

      ease:
        "Back.easeOut"
    });
  }

  private squash(
    fx: PlayerFx,
    x: number,
    y: number,
    duration: number
  ) {

    this.tweens.killTweensOf(
      fx
    );

    fx.sqX =
      x;

    fx.sqY =
      y;

    this.tweens.add({

      targets:
        fx,

      sqX:
        1,

      sqY:
        1,

      duration,

      ease:
        "Quad.easeOut"
    });
  }

  // Reacts to a new state from the server:
  // steers the sprite and fires jump /
  // landing effects.

  private applyPlayerState(
    player: PlayerData,
    sprite:
      Phaser.Physics.Arcade.Sprite
  ) {

    const fx =
      this.playerFx.get(
        player.id
      );

    if (!fx) {

      sprite.setPosition(
        player.x,
        player.y + 30
      );

      return;
    }

    // The local player's position comes from
    // the prediction, other players' from the
    // snapshot buffer (see animatePlayers);
    // the raw server position is only used
    // when neither applies.

    if (
      fx.isLocal
        ? !NET_SETTINGS.predict
        : NET_SETTINGS.interpolationMs <= 0
    ) {

      fx.tx =
        player.x;

      fx.ty =
        player.y + 30;
    }

    fx.vx =
      player.velocityX ?? 0;

    if (fx.vx > 5) {
      fx.facing = 1;
    } else if (fx.vx < -5) {
      fx.facing = -1;
    }

    const volume =
      fx.isLocal ? 1 : 0.35;

    const jumpCount =
      player.jumpCount ?? 0;

    const grounded =
      player.grounded ?? false;

    // ---- jumped ----

    if (
      jumpCount > fx.jumpCount &&
      jumpCount > 0
    ) {

      audio.sfx(
        jumpCount >= 2
          ? "doubleJump"
          : "jump",
        { volume }
      );

      this.squash(
        fx,
        0.72,
        1.32,
        200
      );

      burst(
        this,
        fx.tx,
        fx.ty,
        {
          count:
            jumpCount >= 2 ? 9 : 6,

          color:
            jumpCount >= 2
              ? 0xffffff
              : 0xbbbbbb,

          speedMin: 30,
          speedMax: 110,
          angleMin: 200,
          angleMax: 340,
          gravityY: -20,
          lifespan: 320,
          scaleStart: 0.9
        }
      );
    }

    // ---- landed ----

    if (
      grounded &&
      !fx.grounded
    ) {

      const impact =
        Math.min(
          1,
          Math.max(
            0,
            (fx.airVy - 120) / 600
          )
        );

      audio.sfx(
        "land",
        {
          volume:
            volume *
            (0.35 + impact * 0.65)
        }
      );

      this.squash(
        fx,
        1 + 0.12 + impact * 0.3,
        1 - 0.1 - impact * 0.28,
        170
      );

      burst(
        this,
        fx.tx,
        fx.ty,
        {
          count:
            4 + Math.round(impact * 8),

          color: 0xbbbbbb,
          speedMin: 30,
          speedMax: 90 + impact * 80,
          angleMin: 190,
          angleMax: 350,
          gravityY: 40,
          lifespan: 360,
          scaleStart: 0.9
        }
      );
    }

    if (!grounded) {

      fx.airVy =
        Math.max(
          fx.airVy,
          player.velocityY ?? 0
        );

    } else {

      fx.airVy = 0;
    }

    fx.jumpCount =
      jumpCount;

    fx.grounded =
      grounded;
  }

  // Runs every frame: eases the sprites to
  // the server position and animates them.

  private animatePlayers(
    delta: number
  ) {

    const dt =
      Math.min(
        delta / 1000,
        0.1
      );

    // Frame-rate independent easing.
    const k =
      1 - Math.exp(-dt * 35);

    const now =
      this.time.now / 1000;

    for (
      const [id, fx]
      of this.playerFx
    ) {

      const sprite =
        id === this.room.sessionId
          ? this.localPlayer
          : this.remotePlayers.get(
              id
            );

      if (!sprite) {
        continue;
      }

      // ---- where the picture should be ----

      const away =
        this.playerData.get(id)
          ?.connected === false;

      if (fx.isLocal) {

        const shown =
          this.isPredicting()
            ? this.predictor!.render()
            : null;

        if (shown) {

          fx.tx = shown.x;
          fx.ty = shown.y + 30;
        }

      } else if (
        NET_SETTINGS.interpolationMs > 0 &&
        !away
      ) {

        const at =
          this.snapshots
            .get(id)
            ?.sample(
              performance.now() -
                NET_SETTINGS.interpolationMs
            );

        if (at) {

          fx.tx = at.x;
          fx.ty = at.y;
        }
      }

      const ghost =
        this.ghostLabels.get(id);

      if (ghost) {

        ghost.setPosition(
          sprite.x,
          sprite.y - 98
        );
      }

      this.updateNameLabel(
        id,
        sprite
      );

      // ---- position ----

      const dx =
        fx.tx - sprite.x;

      const dy =
        fx.ty - sprite.y;

      if (
        Math.hypot(dx, dy) > 90
      ) {

        // Teleport (respawn).
        sprite.setPosition(
          fx.tx,
          fx.ty
        );

      } else if (
        fx.isLocal &&
        this.isPredicting()
      ) {

        // Already smooth; easing would only
        // add delay.
        sprite.setPosition(
          fx.tx,
          fx.ty
        );

      } else {

        sprite.setPosition(
          sprite.x + dx * k,
          sprite.y + dy * k
        );
      }

      sprite.setFlipX(
        fx.facing < 0
      );

      // ---- walk bob / idle breathing ----

      let bob = 0;

      let tilt = 0;

      const walking =
        fx.grounded &&
        Math.abs(fx.vx) > 10;

      if (walking) {

        fx.phase +=
          dt * 16;

        bob =
          Math.abs(
            Math.sin(fx.phase)
          ) * 0.07;

        tilt =
          Math.sin(fx.phase) * 4;

        fx.dust -= dt;

        if (fx.dust <= 0) {

          fx.dust = 0.17;

          burst(
            this,
            sprite.x -
              fx.facing * 8,
            sprite.y,
            {
              count: 2,
              color: 0xaaaaaa,
              speedMin: 10,
              speedMax: 40,
              angleMin: 190,
              angleMax: 350,
              gravityY: -10,
              lifespan: 260,
              scaleStart: 0.7
            }
          );
        }

      } else {

        fx.phase = 0;

        bob =
          Math.sin(
            now * 3 + fx.seed
          ) * 0.015 + 0.015;
      }

      sprite.setScale(
        fx.sqX * (1 - bob * 0.6),
        fx.sqY * (1 + bob)
      );

      sprite.setAngle(
        tilt
      );
    }
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

        this.crystalEffects(
          data.id,
          data.score
        );

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

        audio.sfx(
          "doorOpen"
        );

        this.cameras.main.flash(
          260,
          120,
          255,
          160
        );

        if (this.doorRect) {

          burst(
            this,
            this.doorRect.x,
            this.doorRect.y,
            {
              count: 36,
              color: [0x66ff88, 0xffffff, 0xffdd66],
              speedMin: 80,
              speedMax: 260,
              gravityY: 200,
              lifespan: 800,
              scaleStart: 1.3,
              depth: 35
            }
          );
        }

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
          nextLevel: number | null;
          final?: boolean;
          clearMs?: number;
          elapsedMs?: number;
        }
      ) => {

        audio.sfx(
          "levelComplete"
        );

        confettiBurst(
          this,
          400,
          470
        );

        this.cameras.main.flash(
          200,
          255,
          255,
          255
        );

        // "LEVEL CLEAR" stays up until the
        // server starts the next screen.

        this.setPhase(
          "clear",
          {
            level:
              data.completedLevel,

            elapsedMs:
              data.elapsedMs
          }
        );
      }
    );

    // --------------------------------------
    // "LEVEL N" SCREEN, THEN PLAY
    // --------------------------------------

    this.room.onMessage(
      "levelIntro",
      (
        data: {
          level: number;
        }
      ) => {

        this.setPhase(
          "intro",
          {
            level:
              data.level
          }
        );
      }
    );

    this.room.onMessage(
      "levelStarted",
      () => {

        if (
          this.phase !== "playing"
        ) {

          audio.sfx(
            "ready"
          );
        }

        this.setPhase(
          "playing"
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
          cause?: "fell" | "spikes";
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

        this.setPhase(
          "playing"
        );

        audio.stopMusic();

        audio.sfx(
          "win"
        );

        confettiRain(
          this,
          7000
        );

        this.showPersistentMessage(
          "YOU WIN!\n\nALL LEVELS COMPLETE\n\nPress ENTER to go back to the lobby"
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

        audio.sfx(
          "join"
        );

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

        audio.sfx(
          "leave"
        );

        const sprite =
          this.remotePlayers.get(
            data.id
          );

        if (
          sprite
        ) {

          const fx =
            this.playerFx.get(
              data.id
            );

          burst(
            this,
            sprite.x,
            sprite.y - 30,
            {
              count: 18,
              color: fx?.color ?? 0xffffff,
              speedMin: 40,
              speedMax: 200,
              gravityY: 100,
              lifespan: 600,
              depth: 35
            }
          );

          sprite.destroy();
        }

        this.playerFx.delete(
          data.id
        );

        this.nameLabels.get(
          data.id
        )?.destroy();

        this.nameLabels.delete(
          data.id
        );

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
    // PLAYER CONNECTION LOST / BACK
    // --------------------------------------

    this.room.onMessage(
      "playerDropped",
      (
        data: {
          id: string;
        }
      ) => {

        this.setAway(
          data.id,
          true
        );

        const player =
          this.playerData.get(
            data.id
          );

        if (
          data.id !==
            this.room.sessionId &&
          player
        ) {

          this.showTemporaryMessage(
            `PLAYER ${
              player.playerIndex + 1
            } LOST CONNECTION`,
            1800
          );
        }
      }
    );

    this.room.onMessage(
      "playerReconnected",
      (
        data: {
          id: string;
          x: number;
          y: number;
        }
      ) => {

        this.setAway(
          data.id,
          false
        );

        this.placeAt(
          data.id,
          data.x,
          data.y
        );

        if (
          data.id ===
          this.room.sessionId
        ) {
          return;
        }

        audio.sfx(
          "join"
        );

        const player =
          this.playerData.get(
            data.id
          );

        if (player) {

          this.showTemporaryMessage(
            `PLAYER ${
              player.playerIndex + 1
            } IS BACK`,
            1400
          );
        }
      }
    );

    // --------------------------------------
    // FULL RESYNC (after our connection
    // came back)
    // --------------------------------------

    this.room.onMessage(
      "resync",
      (
        data: ResyncData
      ) => {

        this.applyResync(
          data
        );
      }
    );
  }

  // ========================================
  // LEVEL SCREENS ("LEVEL CLEAR" / "LEVEL N")
  // ========================================

  private createBanner() {

    this.bannerVeil =
      this.add.rectangle(
        400,
        300,
        800,
        600,
        0x000000,
        0.6
      )
        .setDepth(500)
        .setVisible(false);

    this.bannerTitle =
      this.add.text(
        400,
        270,
        "",
        {
          fontSize: "76px",
          color: "#ffffff",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 8
        }
      )
        .setOrigin(0.5)
        .setDepth(501)
        .setVisible(false);

    this.bannerSub =
      this.add.text(
        400,
        345,
        "",
        {
          fontSize: "26px",
          color: "#dddddd"
        }
      )
        .setOrigin(0.5)
        .setDepth(501)
        .setVisible(false);
  }

  private showBanner(
    title: string,
    sub: string,
    color: string
  ) {

    if (
      !this.bannerVeil ||
      !this.bannerTitle ||
      !this.bannerSub
    ) {
      return;
    }

    this.bannerTitle.setText(title);

    this.bannerTitle.setColor(color);

    this.bannerSub.setText(sub);

    // Only pop in when it appears; a text
    // update while it is up changes nothing
    // else.

    if (this.bannerVisible) {
      return;
    }

    this.bannerVisible = true;

    for (
      const item
      of [
        this.bannerVeil,
        this.bannerTitle,
        this.bannerSub
      ]
    ) {

      this.tweens.killTweensOf(item);

      item.setVisible(true);
    }

    this.bannerVeil.setAlpha(0);

    this.tweens.add({
      targets: this.bannerVeil,
      alpha: 0.6,
      duration: 250
    });

    for (
      const item
      of [
        this.bannerTitle,
        this.bannerSub
      ]
    ) {

      item.setAlpha(1);

      item.setScale(0.5);

      this.tweens.add({
        targets: item,
        scaleX: 1,
        scaleY: 1,
        duration: 350,
        ease: "Back.easeOut"
      });
    }
  }

  private hideBanner() {

    if (!this.bannerVisible) {
      return;
    }

    this.bannerVisible = false;

    const items = [
      this.bannerVeil,
      this.bannerTitle,
      this.bannerSub
    ];

    for (const item of items) {

      if (!item) {
        continue;
      }

      this.tweens.killTweensOf(item);

      this.tweens.add({
        targets: item,
        alpha: 0,
        duration: 200,
        onComplete: () => {

          // A newer banner may have started.
          if (!this.bannerVisible) {
            item.setVisible(false);
          }
        }
      });
    }
  }

  // Follows the server: while "intro" or
  // "clear" is on, the banner is up and the
  // players cannot move.

  private setPhase(
    phase: LevelPhase,
    info: {
      level?: number;
      elapsedMs?: number;
    } = {}
  ) {

    const changed =
      phase !== this.phase;

    this.phase = phase;

    // A message that was still on screen ("EXIT
    // OPEN!"...) would show through the banner.

    if (
      changed &&
      phase !== "playing"
    ) {

      this.tweens.killTweensOf(
        this.messageText
      );

      this.messageText.setText("");
    }

    if (phase === "playing") {

      if (changed) {

        this.hideBanner();

        // The world was held still: guess the
        // movement again from the server's
        // next state.
        this.predictor?.reset();
      }

      return;
    }

    // The server's state repeats the phase every
    // tick without the details (time taken): do
    // not wipe what the message already showed.

    if (
      phase === "clear" &&
      !info.elapsedMs &&
      this.bannerVisible
    ) {
      return;
    }

    const title =
      phase === "clear"
        ? "LEVEL CLEAR"
        : `LEVEL ${
            info.level ??
            (this.shownLevel || 1)
          }`;

    const sub =
      phase === "clear"
        ? info.elapsedMs
          ? `Time ${formatTime(
              info.elapsedMs
            )}`
          : ""
        : "Get ready!";

    this.showBanner(
      title,
      sub,
      phase === "clear"
        ? "#66ff88"
        : "#ffffff"
    );
  }

  // ========================================
  // CONNECTION
  // ========================================

  // The room is gone for good: the connection
  // could not be restored, or we left.

  private connectionLost(
    code: number
  ) {

    if (this.leaving) {
      return;
    }

    // 4000 = we left on purpose.

    this.returnToMenu(
      false,
      code === 4000
        ? undefined
        : "Connection to the game was lost."
    );
  }

  // The library got us back in. The server
  // sends a resync right after; until then
  // what the scene shows may be stale.

  private afterReconnect() {

    this.predictor?.reset();

    this.snapshots.clear();
  }

  // Rebuilds everything from the server's
  // full picture.

  private applyResync(
    data: ResyncData
  ) {

    const present =
      new Set(
        data.players.map(
          player =>
            player.id
        )
      );

    // Players who left while we were away.

    for (
      const [id, sprite]
      of Array.from(
        this.remotePlayers
      )
    ) {

      if (!present.has(id)) {

        sprite.destroy();

        this.remotePlayers.delete(id);
        this.playerFx.delete(id);
        this.playerData.delete(id);
        this.snapshots.delete(id);

        this.ghostLabels
          .get(id)
          ?.destroy();

        this.ghostLabels.delete(id);

        this.nameLabels
          .get(id)
          ?.destroy();

        this.nameLabels.delete(id);
      }
    }

    // Everyone who is there now.

    for (const player of data.players) {

      this.playerData.set(
        player.id,
        player
      );

      this.createPlayer(
        player
      );

      this.setAway(
        player.id,
        player.connected === false
      );

      this.placeAt(
        player.id,
        player.x,
        player.y
      );
    }

    this.predictor?.reset();

    this.snapshots.clear();

    this.setPhase(
      data.phase ?? "playing",
      {
        level: data.level?.level
      }
    );

    // Rebuild the roster chips.

    this.chipSignature = "";

    this.updatePlayerHud();

    if (data.level) {

      this.applyLevel(
        data.level
      );
    }
  }

  // The player's chosen name, floating over them.
  // Yours sits above the "YOU" marker.

  private updateNameLabel(
    id: string,
    sprite:
      Phaser.Physics.Arcade.Sprite
  ) {

    const name =
      this.playerData.get(id)?.name;

    if (!name) {
      return;
    }

    const isLocal =
      id === this.room.sessionId;

    let label =
      this.nameLabels.get(id);

    if (!label) {

      label =
        this.add.text(
          0,
          0,
          name,
          {
            fontSize: "13px",
            color: "#ffffff",
            fontStyle:
              isLocal
                ? "bold"
                : "normal",
            stroke: "#000000",
            strokeThickness: 3
          }
        )
          .setOrigin(0.5, 1)
          .setDepth(21);

      this.nameLabels.set(
        id,
        label
      );

    } else if (label.text !== name) {

      label.setText(name);
    }

    label.setPosition(
      sprite.x,
      sprite.y - (isLocal ? 88 : 68)
    );

    label.setVisible(
      sprite.visible
    );

    // Greyed out together with an absent player.
    label.setAlpha(
      sprite.alpha
    );
  }

  // Puts a player's sprite at a position
  // right away (no easing).

  private placeAt(
    id: string,
    x: number,
    y: number
  ) {

    const sprite =
      id === this.room.sessionId
        ? this.localPlayer
        : this.remotePlayers.get(
            id
          );

    const fx =
      this.playerFx.get(
        id
      );

    if (!sprite || !fx) {
      return;
    }

    fx.tx = x;
    fx.ty = y + 30;

    sprite.setPosition(
      fx.tx,
      fx.ty
    );

    this.snapshots.get(
      id
    )?.clear();

    if (id === this.room.sessionId) {
      this.predictor?.reset();
    }
  }

  // Greys out a player whose connection is
  // down.

  private setAway(
    id: string,
    away: boolean
  ) {

    const sprite =
      id === this.room.sessionId
        ? this.localPlayer
        : this.remotePlayers.get(
            id
          );

    if (!sprite) {
      return;
    }

    sprite.setAlpha(
      away ? 0.3 : 1
    );

    const existing =
      this.ghostLabels.get(
        id
      );

    if (!away) {

      existing?.destroy();

      this.ghostLabels.delete(
        id
      );

      return;
    }

    if (existing) {
      return;
    }

    this.ghostLabels.set(
      id,
      this.add.text(
        sprite.x,
        sprite.y - 98,
        "CONNECTION LOST",
        {
          fontSize: "11px",
          color: "#ffcc66",
          backgroundColor: "#00000088",
          padding: {
            left: 4,
            right: 4,
            top: 2,
            bottom: 2
          }
        }
      )
        .setOrigin(0.5, 1)
        .setDepth(40)
    );
  }

  // ========================================
  // RETURN TO MENU
  // ========================================

  // After the last level the room is a lobby
  // again (the server reset everyone to "not
  // ready"): go there to play another round
  // with the same people.

  private returnToLobby() {

    if (this.leaving) {
      return;
    }

    this.leaving = true;

    this.scene.start(
      "LobbyScene",
      {
        mode: "resume",

        room:
          this.room,

        statusMessage:
          "Good game! Ready up for another round."
      }
    );
  }

  private returnToMenu(
    leaveRoom: boolean,
    notice?: string
  ) {

    if (this.leaving) {
      return;
    }

    this.leaving = true;

    // Leaving, or the room is gone: there is
    // nothing to come back to after a reload.

    tabSession.forget();

    if (leaveRoom) {

      this.room.leave()
        .catch(() => {});
    }

    this.scene.start(
      "MenuScene",
      {
        notice
      }
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

    this.setPhase(
      state.phase ?? "playing",
      {
        level: state.level
      }
    );

    this.predictor?.setOthers(
      state.players as NetPlayer[]
    );

    const received =
      performance.now();

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

        // The predictor compares its guess
        // with the server and fixes itself.

        if (
          NET_SETTINGS.predict &&
          this.predictor
        ) {

          this.predictor.reconcile(
            player as NetPlayer
          );
        }

        if (
          this.localPlayer &&
          !this.isPredicting()
        ) {

          this.applyPlayerState(
            player,
            this.localPlayer
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

        this.applyPlayerState(
          player,
          sprite
        );

        sprite.setVisible(
          player.alive !== false
        );

        // Remember where they were, for the
        // smoothed drawing (animatePlayers).

        let buffer =
          this.snapshots.get(
            player.id
          );

        if (!buffer) {

          buffer =
            new SnapshotBuffer();

          this.snapshots.set(
            player.id,
            buffer
          );
        }

        buffer.push(
          received,
          player.x,
          player.y + 30
        );

        this.setAway(
          player.id,
          player.connected === false
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
          state.playersNeeded ??
            state.players.length
        }`
      );
    }

    this.updatePlayerHud();
  }

  // True while the local sprite is driven by
  // the prediction instead of the server.

  private isPredicting(): boolean {

    return (
      NET_SETTINGS.predict &&
      this.phase === "playing" &&
      !this.gameFinished &&
      !this.hud?.offline &&
      this.predictor?.body != null
    );
  }

  // ========================================
  // EXIT DOOR
  // ========================================

  private buildDoor(
    exit: LevelData["exit"]
  ) {

    if (this.doorRect) {

      this.tweens.killTweensOf(
        this.doorRect
      );
    }

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

    // Open door glows.

    if (this.doorRect) {

      this.tweens.killTweensOf(
        this.doorRect
      );

      this.doorRect.setAlpha(
        1
      );

      if (open) {

        this.tweens.add({

          targets:
            this.doorRect,

          alpha:
            0.65,

          duration:
            520,

          yoyo:
            true,

          repeat:
            -1,

          ease:
            "Sine.easeInOut"
        });
      }
    }

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

    // Fade in when moving on to a new level.

    if (
      data.level !==
      this.shownLevel
    ) {

      if (
        this.shownLevel !== 0
      ) {

        this.cameras.main.fadeIn(
          450
        );
      }

      this.shownLevel =
        data.level;

      // Everyone is moved to the spawn points.
      this.predictor?.reset();

      this.snapshots.clear();
    }

    this.targetScore =
      data.targetScore;

    this.predictor?.setWorld({
      platforms: data.platforms,
      pits: data.pits
    });

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

    this.buildGround(
      data.pits
    );

    this.buildSpikes(
      data.spikes,
      data.spikeHeight
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
          player.id +
          (player.connected === false
            ? "!"
            : "")
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

    for (
      const label
      of this.latencyLabels
    ) {

      label.destroy();
    }

    this.latencyLabels =
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

        if (
          player.connected === false
        ) {

          chip.setAlpha(
            0.35
          );
        }

        this.playerChips.push(
          chip
        );

        // Ping under the chip.

        const label =
          this.add.text(
            780 - index * 24 - 8,
            72,
            "",
            {
              fontSize: "10px",
              color: "#888888"
            }
          ).setOrigin(
            0.5,
            0
          );

        label.setDepth(
          10
        );

        label.setData(
          "id",
          player.id
        );

        this.latencyLabels.push(
          label
        );
      }
    );

    this.refreshLatencyLabels();
  }

  // The ping numbers under the player chips.

  private refreshLatencyLabels() {

    for (
      const label
      of this.latencyLabels
    ) {

      if (!label.active) {
        continue;
      }

      const id =
        label.getData(
          "id"
        ) as string;

      const away =
        this.playerData.get(id)
          ?.connected === false;

      const rtt =
        away
          ? null
          : this.hud?.rttOf(
              id
            ) ?? null;

      label.setText(
        away
          ? "×"
          : rtt === null
            ? ""
            : String(rtt)
      );

      label.setColor(
        "#" +
          QUALITY_COLORS[
            away
              ? "offline"
              : qualityOf(rtt)
          ]
            .toString(16)
            .padStart(6, "0")
      );
    }
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

      this.tweens.killTweensOf(
        platform
      );

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

      // Platforms fade in one after another.

      object.setAlpha(
        0
      );

      this.tweens.add({

        targets:
          object,

        alpha:
          1,

        duration:
          300,

        delay:
          this.platformObjects.length * 70
      });

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

      // Idle: bob up and down and pulse,
      // each crystal out of phase.

      this.tweens.add({

        targets:
          sprite,

        y:
          crystal.y - 4,

        duration:
          700 + Math.random() * 500,

        yoyo:
          true,

        repeat:
          -1,

        ease:
          "Sine.easeInOut",

        delay:
          Math.random() * 600
      });

      this.tweens.add({

        targets:
          sprite,

        scale:
          1.18,

        duration:
          520 + Math.random() * 300,

        yoyo:
          true,

        repeat:
          -1,

        ease:
          "Sine.easeInOut",

        delay:
          Math.random() * 600
      });

      this.crystalSprites.set(
        crystal.id,
        sprite
      );
    }
  }

  // ========================================
  // CRYSTAL EFFECTS
  // ========================================

  private crystalEffects(
    id: number,
    score: number
  ) {

    const crystal =
      this.crystalSprites.get(
        id
      );

    // Rising pitch as the shared score
    // climbs.

    audio.sfx(
      "crystal",
      {
        pitch:
          1 + (score % 8) * 0.07
      }
    );

    if (crystal) {

      burst(
        this,
        crystal.x,
        crystal.y,
        {
          count: 14,
          color: [0x66ddff, 0xffffff],
          speedMin: 50,
          speedMax: 190,
          gravityY: 120,
          lifespan: 520,
          scaleStart: 1.1,
          depth: 35
        }
      );

      floatText(
        this,
        crystal.x,
        crystal.y - 14,
        "+1",
        "#66ddff"
      );
    }

    // Punch the counter.

    this.tweens.killTweensOf(
      this.scoreText
    );

    this.scoreText.setScale(
      1.25
    );

    this.tweens.add({

      targets:
        this.scoreText,

      scaleX:
        1,

      scaleY:
        1,

      duration:
        220,

      ease:
        "Back.easeOut"
    });
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

    // Stop the idle bob before collecting.

    this.tweens.killTweensOf(
      crystal
    );

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
      cause?: "fell" | "spikes";
    }
  ) {

    const isLocal =
      data.id ===
      this.room.sessionId;

    const sprite =
      isLocal
        ? this.localPlayer
        : this.remotePlayers.get(
            data.id
          );

    const fx =
      this.playerFx.get(
        data.id
      );

    const volume =
      isLocal ? 1 : 0.4;

    // ---- death burst where they were ----

    if (sprite && fx) {

      burst(
        this,
        sprite.x,
        sprite.y - 30,
        {
          count: 26,
          color: [fx.color, 0xffffff],
          speedMin: 80,
          speedMax: 320,
          gravityY: 600,
          lifespan: 700,
          scaleStart: 1.4,
          depth: 35
        }
      );

      // ---- reappear at the spawn point ----

      fx.tx = data.x;
      fx.ty = data.y + 30;
      fx.grounded = false;
      fx.jumpCount = 0;
      fx.airVy = 0;

      sprite.setPosition(
        fx.tx,
        fx.ty
      );

      this.snapshots.get(
        data.id
      )?.clear();

      if (isLocal) {

        // The server moved us: guess again
        // from its next state.
        this.predictor?.reset();
      }

      this.tweens.killTweensOf(
        fx
      );

      fx.sqX = 0.2;
      fx.sqY = 0.2;

      this.tweens.add({

        targets:
          fx,

        sqX:
          1,

        sqY:
          1,

        duration:
          350,

        ease:
          "Back.easeOut"
      });
    }

    audio.sfx(
      data.cause === "spikes"
        ? "spikes"
        : "fall",
      { volume }
    );

    this.time.delayedCall(
      350,
      () =>
        audio.sfx(
          "respawn",
          { volume: volume * 0.7 }
        )
    );

    if (!isLocal) {
      return;
    }

    this.showTemporaryMessage(
      data.cause === "spikes"
        ? "OUCH! SPIKES!"
        : data.cause === "fell"
          ? "YOU FELL!"
          : "RESPAWN!",
      800
    );

    this.cameras.main.shake(
      140,
      0.006
    );

    this.cameras.main.flash(
      140,
      255,
      60,
      60
    );
  }

  // ========================================
  // MESSAGE
  // ========================================

  // Stays on screen. Cancels any fade-out
  // still running from an earlier message,
  // which would otherwise clear this one.

  private showPersistentMessage(
    message: string
  ) {

    this.tweens.killTweensOf(
      this.messageText
    );

    this.messageText.setText(
      message
    );

    this.messageText.setAlpha(
      1
    );

    this.messageText.setScale(
      0.6
    );

    this.tweens.add({

      targets:
        this.messageText,

      scaleX:
        1,

      scaleY:
        1,

      duration:
        320,

      ease:
        "Back.easeOut"
    });
  }

  private showTemporaryMessage(
    message: string,
    duration: number
  ) {

    // A newer message replaces an older one
    // (and its fade-out).

    this.tweens.killTweensOf(
      this.messageText
    );

    this.messageText.setText(
      message
    );

    this.messageText.setAlpha(
      1
    );

    this.messageText.setScale(
      0.6
    );

    this.tweens.add({

      targets:
        this.messageText,

      scaleX:
        1,

      scaleY:
        1,

      duration:
        220,

      ease:
        "Back.easeOut"
    });

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

  update(
    _time: number,
    delta: number
  ) {

    if (!this.room) {
      return;
    }

    // Input and prediction first, so the
    // picture drawn this frame already
    // contains this frame's key presses.

    this.driveLocalPlayer(
      delta
    );

    this.animatePlayers(
      delta
    );

    if (this.localPlayer) {

      this.youMarker.setPosition(
        this.localPlayer.x,
        this.localPlayer.y - 68
      );

      this.youMarker.setVisible(
        true
      );
    }
  }

  // Reads the keys, runs the prediction and
  // sends the input to the server.

  private driveLocalPlayer(
    delta: number
  ) {

    if (!this.localPlayer) {
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

    if (this.gameFinished) {

      if (
        Phaser.Input.Keyboard.JustDown(
          this.keys.ENTER
        )
      ) {

        this.returnToLobby();
      }

      return;
    }

    // While the connection is down the
    // library would only queue the input and
    // replay a burst of it later: wait instead.

    if (this.hud?.offline) {
      return;
    }

    // "LEVEL CLEAR" / "LEVEL N": nobody can
    // move (the server ignores input too).

    if (this.phase !== "playing") {
      return;
    }

    const input = {
      left,

      right,

      jump
    };

    let seq: number | null = null;

    if (
      NET_SETTINGS.predict &&
      this.predictor
    ) {

      seq =
        this.predictor.step(
          input,
          delta / 1000
        );

      this.predictor.decay(
        delta / 1000
      );

      this.showPredictedEffects();
    }

    this.room.send(
      "input",
      seq === null
        ? input
        : {
            ...input,
            seq
          }
    );
  }

  // Jump and landing effects come from the
  // predicted state, so they play at once
  // instead of a round trip later.

  private showPredictedEffects() {

    const body =
      this.predictor?.body;

    if (
      !body ||
      !this.localPlayer ||
      !this.isPredicting()
    ) {
      return;
    }

    this.applyPlayerState(
      {
        id:
          this.room.sessionId,

        x: body.x,
        y: body.y,

        playerIndex: 0,
        color: 0,
        ready: true,

        velocityX: body.velocityX,
        velocityY: body.velocityY,

        alive: true,

        jumpCount: body.jumpCount,

        grounded: body.grounded
      },
      this.localPlayer
    );
  }

  // ========================================
  // SHUTDOWN
  // ========================================

  shutdown() {

    console.log(
      "GameScene shutting down."
    );

    this.hud?.dispose();

    this.hud = null;

    for (
      const item
      of [
        this.bannerVeil,
        this.bannerTitle,
        this.bannerSub
      ]
    ) {

      item?.destroy();
    }

    this.bannerVeil = null;
    this.bannerTitle = null;
    this.bannerSub = null;
    this.bannerVisible = false;

    this.predictor = null;

    this.snapshots.clear();

    for (
      const label
      of [
        ...this.ghostLabels.values(),
        ...this.nameLabels.values(),
        ...this.latencyLabels
      ]
    ) {

      label.destroy();
    }

    this.ghostLabels.clear();

    this.nameLabels.clear();

    this.latencyLabels = [];

    // Stop listening: the server may still
    // send messages while we leave, and the
    // handlers use scene objects that are
    // about to be destroyed.

    if (this.room) {

      this.room.removeAllListeners();

      this.room.onMessage(
        "*",
        () => {}
      );
    }

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

    for (
      const object
      of [
        ...this.groundObjects,
        ...this.hazardObjects
      ]
    ) {

      object.destroy();
    }

    this.groundObjects =
      [];

    this.hazardObjects =
      [];

    this.playerFx.clear();
  }
}