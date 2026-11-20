import Phaser from "phaser";
import { Room } from "@colyseus/sdk";
import { NetworkManager } from "../network/NetworkManager";
import { audio } from "../audio/AudioManager";
import { ConnectionHud } from "../net/ConnectionHud";
import { tabSession } from "../net/session";
import { copyToClipboard } from "../net/clipboard";
import { QUALITY_COLORS, qualityOf } from "../net/latency";
import {
  joinOptions,
  loadProfile,
  saveProfile
} from "../profile";
import {
  NAME_MAX,
  PALETTE,
  defaultName,
  sanitizeName
} from "../shared/profile";

import {
  addMuteButton,
  juiceButton
} from "../effects";

import {
  addBackground,
  addPillHeading,
  addTitle,
  drawPanel
} from "../ui/draw";

import {
  drawIcon,
  drawSignal
} from "../ui/icons";

import {
  COLOR,
  FONT_BODY,
  hex
} from "../ui/theme";

import { UiButton } from "../ui/UiButton";

// ------------------------------------------------------------
// LAYOUT (game coordinates, 800 x 600)
// ------------------------------------------------------------

// the room code panel
const CODE_Y = 187;

const CODE_BOX_X = 410;

// the roster: one row per seat
const ROW_TOP = 250;

const ROW_STEP = 47;

const ROW_WIDTH = 648;

const ROW_HEIGHT = 42;

const COL_DOT = 107;

const COL_NAME = 136;

// the right edge of the status pill; the ping sits after it
const COL_PILL_RIGHT = 626;

const COL_BARS = 660;

const COL_PING = 672;

const SLOTS = 4;

// the buttons
const BUTTONS_Y = 480;

const READY_X = 247;

const START_X = 538;

interface PlayerData {
  id: string;
  x: number;
  y: number;
  playerIndex: number;

  // Chosen by the player; the server has cleaned it.
  name?: string;

  color: number;
  ready: boolean;

  // False while the player's connection is
  // down and the server holds their seat.
  connected?: boolean;
}

// What the server sends to bring a client up
// to date after its connection came back.
interface ResyncData {
  roomCode: string;
  hostId: string;
  gameStarted: boolean;
  gameFinished: boolean;
  players: PlayerData[];
}

export class LobbyScene extends Phaser.Scene {

  // "resume": back in a room we were already
  // in (after a page reload).
  private mode:
    "create" | "join" | "resume" = "create";

  // Room and first picture handed over by the
  // menu when resuming.
  private resumeRoom: Room | null = null;

  private resumeData: ResyncData | null = null;

  // Shown instead of "Back in your room!" when
  // the game scene sends everyone back here
  // after a finished game.
  private statusMessage = "";

  // Ping chip and "connection lost" veil.
  private hud: ConnectionHud | null = null;

  // The room outlives this scene: every
  // listener added here is removed again.
  private unsubs: (() => void)[] = [];

  // Set once the lobby hands over to the game (or is shut
  // down): a message that still arrives must not touch
  // pictures that are being taken down.
  private closing = false;

  private network!: NetworkManager;
  private room!: Room;

  private roomCode = "";

  // Throttle for the join sound.
  private lastJoinSound = 0;

  // Session id of the host (set by the server).
  private hostId = "";

  private players: Map<string, PlayerData> =
    new Map();

  private playerTexts:
    Map<string, Phaser.GameObjects.Text> =
    new Map();

  // Public so the browser tests can find and click them.
  readyButton!: UiButton;

  startButton!: UiButton;

  leaveButton!: UiButton;

  private statusText!:
    Phaser.GameObjects.Text;

  roomCodeText!:
    Phaser.GameObjects.Text;

  // "COPY" next to the room code.
  copyButton:
    UiButton | null = null;

  private copyResetTimer:
    Phaser.Time.TimerEvent | null = null;

  private errorText!:
    Phaser.GameObjects.Text;

  constructor() {
    super("LobbyScene");
  }

  // ==========================================
  // INIT
  // ==========================================

  init(
    data: {
      mode: "create" | "join" | "resume";
      room?: Room;
      resync?: ResyncData;
      statusMessage?: string;
    }
  ) {
    this.mode = data.mode;

    this.statusMessage =
      data.statusMessage ?? "";

    this.resumeRoom = data.room ?? null;

    this.resumeData = data.resync ?? null;

    this.hud = null;

    this.unsubs = [];

    this.closing = false;

    this.copyButton = null;

    this.copyResetTimer = null;

    this.players = new Map();

    this.playerTexts = new Map();
  }

  // ==========================================
  // CREATE
  // ==========================================

  async create() {

    addBackground(this);

    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.teardown()
    );

    addMuteButton(
      this,
      20,
      565
    );

    audio.playMusic(
      "menu"
    );

    // ----------------------------------------
    // TITLE
    // ----------------------------------------

    addTitle(
      this,
      52,
      34
    );

    addPillHeading(
      this,
      110,
      "LOBBY"
    );

    // ----------------------------------------
    // STATUS
    // ----------------------------------------

    this.statusText =
      this.add.text(
        400,
        146,
        "Connecting...",
        {
          fontSize: "19px",
          color: COLOR.text
        }
      ).setOrigin(0.5);

    // ----------------------------------------
    // ROOM CODE
    // ----------------------------------------
    //
    // A panel: the words ROOM CODE, the code in its own box,
    // and COPY. The code appears when the server has told us.
    // Clicking COPY (or the code) puts it on the clipboard so
    // it can be pasted to friends.

    const codePanel =
      this.add.graphics();

    drawPanel(
      codePanel,
      400,
      CODE_Y,
      494,
      46,
      {
        fill: COLOR.panel,
        stroke: COLOR.strokeSoft,
        strokeWidth: 2,
        radius: 12
      }
    );

    this.add.text(
      186,
      CODE_Y,
      "ROOM CODE:",
      {
        fontSize: "17px",
        fontStyle: "bold",
        color: COLOR.textSoft
      }
    ).setOrigin(0, 0.5);

    drawPanel(
      codePanel,
      CODE_BOX_X,
      CODE_Y,
      166,
      36,
      {
        fill: COLOR.panelDeep,
        stroke: COLOR.strokeSoft,
        strokeWidth: 1,
        radius: 8
      }
    );

    this.roomCodeText =
      this.add.text(
        CODE_BOX_X,
        CODE_Y,
        "------",
        {
          fontSize: "26px",
          color: "#ffffff",
          fontStyle: "bold"
        }
      ).setOrigin(0.5);

    this.copyButton =
      new UiButton(
        this,
        {
          x: 579,
          y: CODE_Y,
          width: 126,
          height: 38,
          label: "COPY",
          fontSize: 16,
          icon: "copy",
          variant: "primary",
          radius: 9
        }
      );

    this.copyButton.setVisible(false);

    juiceButton(
      this,
      this.copyButton
    );

    this.copyButton.on(
      "pointerdown",
      () => {
        void this.copyRoomCode();
      }
    );

    this.roomCodeText.setInteractive({
      useHandCursor: true
    });

    this.roomCodeText.on(
      "pointerdown",
      () => {
        void this.copyRoomCode();
      }
    );

    // ----------------------------------------
    // A LINE OF HELP UNDER THE ROSTER
    // ----------------------------------------

    {

      const hint =
        this.add.text(
          0,
          428,
          "host - click your colour or name to change them",
          {
            fontSize: "13px",
            color: COLOR.textDim
          }
        ).setOrigin(0.5);

      const star =
        this.add.graphics();

      const gap = 10;

      const iconSize = 15;

      const total =
        iconSize + gap + hint.width;

      star.setPosition(
        400 - total / 2 + iconSize / 2,
        428
      );

      drawIcon(
        star,
        "star",
        iconSize,
        0x8a90b4
      );

      hint.setX(
        400 - total / 2 + iconSize + gap + hint.width / 2
      );
    }

    // ----------------------------------------
    // ERROR
    // ----------------------------------------

    this.errorText =
      this.add.text(
        400,
        219,
        "",
        {
          fontSize: "14px",
          color: COLOR.red_
        }
      ).setOrigin(0.5);

    // ----------------------------------------
    // NETWORK
    // ----------------------------------------

    try {

      this.network =
        new NetworkManager();

      // ======================================
      // RESUME (after a page reload)
      // ======================================

      if (
        this.mode === "resume" &&
        this.resumeRoom
      ) {

        this.room =
          this.resumeRoom;

        this.network.room =
          this.room;

        this.statusText.setText(
          this.statusMessage ||
            "Back in your room!"
        );
      }

      // ======================================
      // CREATE ROOM
      // ======================================

      else if (this.mode === "create") {

        this.statusText.setText(
          "Creating room..."
        );

        this.room =
          await this.network.createRoom(
            joinOptions(
              loadProfile()
            )
          );

        this.statusText.setText(
          "Room created!"
        );

      }

      // ======================================
      // JOIN ROOM
      // ======================================

      else {

        const code =
          window.prompt(
            "Enter the 6-character room code:"
          );

        if (!code) {

          this.scene.start(
            "MenuScene"
          );

          return;
        }

        this.statusText.setText(
          "Finding room..."
        );

        this.room =
          await this.network.joinRoomByCode(
            code.trim().toUpperCase(),
            joinOptions(
              loadProfile()
            )
          );

        this.statusText.setText(
          "Joined room!"
        );
      }

      // ======================================
      // SET LISTENERS
      // ======================================

      this.setupRoomListeners();

      // ======================================
      // CREATE BUTTONS
      // ======================================

      this.createLobbyButtons();

      // The server tells everyone who is there
      // when we join. When resuming we missed
      // that, so ask again.

      if (this.mode === "resume") {

        if (this.resumeData) {

          this.applyResync(
            this.resumeData
          );
        }

        this.room.send(
          "requestResync"
        );
      }

    } catch (error) {

      console.error(
        "Lobby connection failed:",
        error
      );

      this.statusText.setText(
        "Connection failed"
      );

      this.errorText.setText(
        error instanceof Error
          ? error.message
          : "Could not connect to room"
      );

      this.createBackButton();
    }
  }

  // ==========================================
  // ROOM LISTENERS
  // ==========================================

  private setupRoomListeners() {

    // ----------------------------------------
    // ROOM CODE
    // ----------------------------------------

    this.listen(
      "roomCode",
      (data: {
        roomCode: string;
      }) => {

        console.log(
          "Received room code:",
          data.roomCode
        );

        this.roomCode =
          data.roomCode;

        this.roomCodeText.setText(
          data.roomCode
        );

        this.layoutRoomCode();

        tabSession.remember(
          this.room.reconnectionToken,
          data.roomCode
        );

        this.copyButton?.setVisible(
          true
        );

        this.layoutRoomCode();
      }
    );

    // ----------------------------------------
    // MY PLAYER
    // ----------------------------------------

    this.listen(
      "playerJoinedSelf",
      (player: PlayerData) => {

        console.log(
          "My player:",
          player
        );

        this.players.set(
          player.id,
          player
        );

        this.updatePlayerList();
        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // PLAYER JOINED
    // ----------------------------------------

    this.listen(
      "playerJoined",
      (player: PlayerData) => {

        console.log(
          "Player joined:",
          player
        );

        const now =
          Date.now();

        if (
          now - this.lastJoinSound >
          400
        ) {

          this.lastJoinSound =
            now;

          audio.sfx(
            "join"
          );
        }

        this.players.set(
          player.id,
          player
        );

        this.updatePlayerList();
        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // READY CHANGED
    // ----------------------------------------

    this.listen(
      "playerReadyChanged",
      (data: {
        id: string;
        ready: boolean;
      }) => {

        console.log(
          "Ready changed:",
          data
        );

        const player =
          this.players.get(
            data.id
          );

        if (!player) {
          return;
        }

        if (
          player.ready !==
          data.ready
        ) {

          audio.sfx(
            data.ready
              ? "ready"
              : "unready",
            {
              volume:
                data.id ===
                this.room.sessionId
                  ? 1
                  : 0.45
            }
          );
        }

        player.ready =
          data.ready;

        this.players.set(
          data.id,
          player
        );

        this.updatePlayerList();
        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // PLAYER LEFT
    // ----------------------------------------

    this.listen(
      "playerLeft",
      (data: {
        id: string;
      }) => {

        console.log(
          "Player left:",
          data.id
        );

        audio.sfx(
          "leave"
        );

        this.players.delete(
          data.id
        );

        this.updatePlayerList();
        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // ALL PLAYERS READY
    // ----------------------------------------

    this.listen(
      "allPlayersReady",
      (data: {
        allReady: boolean;
      }) => {

        console.log(
          "All players ready:",
          data.allReady
        );

        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // GAME STARTED
    // ----------------------------------------

    this.listen(
      "gameStarted",
      () => {

        console.log(
          "Game started!"
        );

        audio.sfx(
          "start"
        );

        this.startGameScene();
      }
    );

    // ----------------------------------------
    // HOST CHANGED
    // ----------------------------------------

    this.listen(
      "hostChanged",
      (data: {
        id: string;
      }) => {

        this.hostId =
          data.id;

        this.updatePlayerList();
        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // START GAME FAILED
    // ----------------------------------------

    this.listen(
      "startGameFailed",
      (data: {
        reason: string;
      }) => {

        console.log(
          "Start game failed:",
          data.reason
        );

        this.errorText.setText(
          data.reason
        );
      }
    );

    // ----------------------------------------
    // CONNECTION
    // ----------------------------------------

    this.hud =
      new ConnectionHud(
        this,
        this.room,
        {
          x: 790,
          y: 592,

          onLost: (code) =>
            this.connectionLost(code),

          onLatencies: () =>
            this.updatePlayerList()
        }
      );

    this.listen(
      "playerDropped",
      (data: {
        id: string;
      }) => {

        const player =
          this.players.get(
            data.id
          );

        if (player) {

          player.connected =
            false;

          this.updatePlayerList();
        }
      }
    );

    this.listen(
      "playerReconnected",
      (data: {
        id: string;
      }) => {

        const player =
          this.players.get(
            data.id
          );

        if (player) {

          player.connected =
            true;

          this.updatePlayerList();
        }
      }
    );

    this.listen(
      "playerProfileChanged",
      (data: {
        id: string;
        name: string;
        color: number;
      }) => {

        const player =
          this.players.get(
            data.id
          );

        if (!player) {
          return;
        }

        player.name =
          data.name;

        player.color =
          data.color;

        // Remember my own colour for next time (the name is
        // remembered as typed, not as the server numbered it).

        if (
          data.id ===
          this.room.sessionId
        ) {

          const profile =
            loadProfile();

          profile.color =
            data.color;

          saveProfile(
            profile
          );
        }

        this.updatePlayerList();
      }
    );

    this.listen(
      "resync",
      (data: ResyncData) => {

        this.applyResync(
          data
        );
      }
    );
  }

  // ==========================================
  // CHANGING NAME AND COLOUR
  // ==========================================

  // The next palette colour nobody else has.

  private nextColor() {

    const mine =
      this.players.get(
        this.room?.sessionId
      );

    if (!mine) {
      return;
    }

    const taken =
      new Set(
        Array.from(
          this.players.values()
        )
          .filter(
            player =>
              player.id !== mine.id
          )
          .map(
            player =>
              player.color
          )
      );

    const start =
      Math.max(
        0,
        (PALETTE as readonly number[])
          .indexOf(
            mine.color
          )
      );

    for (
      let step = 1;
      step <= PALETTE.length;
      step++
    ) {

      const candidate =
        PALETTE[
          (start + step) %
            PALETTE.length
        ];

      if (!taken.has(candidate)) {

        audio.sfx("click");

        this.room.send(
          "setProfile",
          {
            color:
              candidate
          }
        );

        return;
      }
    }
  }

  private askForName() {

    const mine =
      this.players.get(
        this.room?.sessionId
      );

    if (!mine) {
      return;
    }

    const typed =
      window.prompt(
        `Your name (up to ${NAME_MAX} characters):`,
        mine.name ?? ""
      );

    if (typed === null) {
      return;
    }

    const name =
      sanitizeName(typed);

    if (
      !name ||
      name === mine.name
    ) {
      return;
    }

    // Remembered as typed, for next time.

    const profile =
      loadProfile();

    profile.name =
      name;

    saveProfile(
      profile
    );

    this.room.send(
      "setProfile",
      {
        name
      }
    );
  }

  // ==========================================
  // ROOM CODE LAYOUT
  // ==========================================

  // The code and its COPY button are centred
  // as one group.

  private layoutRoomCode() {

    // The code sits in its own box; COPY only appears once the
    // code is known (the box shows ------ until then).

    if (!this.roomCodeText) {
      return;
    }

    this.roomCodeText.setText(
      this.roomCode || "------"
    );
  }

  // ==========================================
  // COPY ROOM CODE
  // ==========================================

  private async copyRoomCode() {

    if (
      !this.roomCode ||
      !this.copyButton
    ) {
      return;
    }

    const copied =
      await copyToClipboard(
        this.roomCode
      );

    // The scene may have changed while the
    // browser was deciding.

    if (
      !this.copyButton ||
      !this.copyButton.active
    ) {
      return;
    }

    audio.sfx(
      copied
        ? "ready"
        : "unready"
    );

    this.copyButton.setText(
      copied
        ? "COPIED!"
        : "PRESS CTRL+C"
    );

    this.copyButton.setVariant(
      copied
        ? "success"
        : "warn"
    );

    // Nothing could be copied (clipboard
    // blocked): select the code for the
    // player instead of failing silently.

    if (!copied) {

      this.errorText.setText(
        `Room code: ${this.roomCode}`
      );
    }

    this.copyResetTimer?.remove(
      false
    );

    this.copyResetTimer =
      this.time.delayedCall(
        1800,
        () => {

          if (
            !this.copyButton?.active
          ) {
            return;
          }

          this.copyButton.setText(
            "COPY"
          );

          this.copyButton.setVariant(
            "primary"
          );

          if (!copied) {
            this.errorText.setText("");
          }
        }
      );
  }

  // ==========================================
  // LISTENERS
  // ==========================================

  private listen(
    type: string,
    callback: (data: any) => void
  ) {

    this.unsubs.push(
      this.room.onMessage(
        type,
        callback
      )
    );
  }

  private teardown() {

    this.closing = true;

    for (const off of this.unsubs) {
      off();
    }

    this.unsubs = [];

    this.hud?.dispose();

    this.hud = null;
  }

  // ==========================================
  // CONNECTION LOST FOR GOOD
  // ==========================================

  private connectionLost(
    code: number
  ) {

    if (
      !this.scene.isActive(
        "LobbyScene"
      )
    ) {
      return;
    }

    // Nothing left to come back to.

    tabSession.forget();

    this.scene.start(
      "MenuScene",
      {
        // 4000: we left on purpose.
        notice:
          code === 4000
            ? undefined
            : "Connection to the room was lost."
      }
    );
  }

  // ==========================================
  // RESYNC
  // ==========================================

  private applyResync(
    data: ResyncData
  ) {

    this.players.clear();

    for (const player of data.players) {

      this.players.set(
        player.id,
        player
      );
    }

    this.hostId =
      data.hostId;

    this.roomCode =
      data.roomCode;

    this.roomCodeText.setText(
      data.roomCode
    );

    this.copyButton?.setVisible(
      true
    );

    this.layoutRoomCode();

    tabSession.remember(
      this.room.reconnectionToken,
      data.roomCode
    );

    // The game started while we were away.

    if (data.gameStarted) {

      this.startGameScene();

      return;
    }

    this.updatePlayerList();
    this.updateStartButton();
  }

  // ==========================================
  // START GAME SCENE
  // ==========================================

  private startGameScene() {

    if (
      !this.scene.isActive(
        "LobbyScene"
      )
    ) {
      return;
    }

    const players =
      Array.from(
        this.players.values()
      );

    const myPlayer =
      this.players.get(
        this.room.sessionId
      );

    this.closing = true;

    this.clearLobbyUI();

    this.registry.set(
      "room",
      this.room
    );

    this.scene.start(
      "GameScene",
      {
        room:
          this.room,

        players:
          players,

        myPlayer:
          myPlayer
      }
    );
  }

  // ==========================================
  // UPDATE PLAYER LIST
  // ==========================================

  private updatePlayerList() {

    if (this.closing) {
      return;
    }

    for (
      const text
      of this.playerTexts.values()
    ) {

      const extras =
        text.getData(
          "extras"
        ) as
          | Phaser.GameObjects.GameObject[]
          | undefined;

      for (const extra of extras ?? []) {
        extra.destroy();
      }

      text.destroy();
    }

    this.playerTexts.clear();

    // One row per seat, taken or not: the table keeps its
    // shape and shows how many players fit.

    for (let slot = 0; slot < SLOTS; slot++) {

      const player =
        Array.from(
          this.players.values()
        ).find(
          candidate =>
            candidate.playerIndex === slot
        );

      const y =
        ROW_TOP + slot * ROW_STEP;

      const extras:
        Phaser.GameObjects.GameObject[] =
        [];

      const background =
        this.add.graphics().setDepth(-1);

      extras.push(background);

      // ---- an empty seat ----

      if (!player) {

        drawPanel(
          background,
          400,
          y,
          ROW_WIDTH,
          ROW_HEIGHT,
          {
            fill: COLOR.panelDeep,
            fillAlpha: 0.55,
            stroke: COLOR.strokeSoft,
            strokeAlpha: 0.7,
            strokeWidth: 1,
            radius: 12
          }
        );

        const icon =
          this.add.graphics()
            .setPosition(COL_DOT, y);

        drawIcon(
          icon,
          "person",
          18,
          0x5b6186
        );

        extras.push(icon);

        const empty =
          this.add.text(
            COL_NAME + 4,
            y,
            "waiting for player...",
            {
              fontSize: "17px",
              color: COLOR.textFaint,
              fontStyle: "italic"
            }
          ).setOrigin(0, 0.5);

        empty.setData(
          "extras",
          extras
        );

        this.playerTexts.set(
          `empty-${slot}`,
          empty
        );

        continue;
      }

      // ---- a player ----

      const away =
        player.connected === false;

      const isHost =
        player.id === this.hostId;

      const isMe =
        player.id ===
        this.room?.sessionId;

      const rtt =
        away
          ? null
          : this.hud?.rttOf(
              player.id
            ) ?? null;

      // the row: yours has a glowing blue edge

      drawPanel(
        background,
        400,
        y,
        ROW_WIDTH,
        ROW_HEIGHT,
        {
          fill: COLOR.panel,
          stroke:
            isMe
              ? COLOR.blue
              : COLOR.strokeSoft,
          strokeWidth: 2,
          radius: 12,
          glow: isMe ? 8 : 0,
          glowStrength: 0.7
        }
      );

      // the player's colour, with a soft halo

      const halo =
        this.add.circle(
          COL_DOT,
          y,
          13,
          player.color,
          0.22
        );

      const dot =
        this.add.circle(
          COL_DOT,
          y,
          8.5,
          player.color
        );

      extras.push(halo, dot);

      // Your own colour: click for the next free one.

      if (isMe) {

        dot.setInteractive({
          useHandCursor: true
        });

        dot.on(
          "pointerdown",
          () => this.nextColor()
        );
      }

      // the name

      let playerName =
        player.name ||
        defaultName(
          player.playerIndex
        );

      if (isHost) {
        playerName +=
          " ★";
      }

      if (isMe) {
        playerName +=
          " (you)";
      }

      const text =
        this.add.text(
          COL_NAME,
          y,
          playerName,
          {
            fontSize: "21px",
            color:
              isMe
                ? "#ffffff"
                : COLOR.textSoft,
            fontStyle:
              isMe
                ? "bold"
                : "normal"
          }
        ).setOrigin(0, 0.5);

      // Your own name: click to change it.

      if (isMe) {

        text.setInteractive({
          useHandCursor: true
        });

        text.on(
          "pointerdown",
          () => this.askForName()
        );
      }

      // the status, in a pill

      const status =
        away
          ? "RECONNECTING"
          : player.ready
            ? "READY"
            : "NOT READY";

      const pillColors =
        away
          ? { fill: 0x4d3f17, text: COLOR.amber_ }
          : player.ready
            ? { fill: 0x1b5a35, text: COLOR.green_ }
            : { fill: 0x2a2e48, text: COLOR.textSoft };

      const statusText =
        this.add.text(
          0,
          y,
          status,
          {
            fontSize: "14px",
            fontStyle: "bold",
            color: pillColors.text
          }
        ).setOrigin(0.5);

      const pillWidth =
        statusText.width + 26;

      const pillX =
        COL_PILL_RIGHT - pillWidth / 2;

      statusText.setX(pillX);

      const pill =
        this.add.graphics();

      drawPanel(
        pill,
        pillX,
        y,
        pillWidth,
        26,
        {
          fill: pillColors.fill,
          radius: 7
        }
      );

      // the pill is drawn below its words
      pill.setDepth(statusText.depth - 0.5);

      extras.push(pill, statusText);

      // the connection: three bars and the time in ms

      if (rtt !== null) {

        const quality =
          qualityOf(rtt);

        const color =
          QUALITY_COLORS[quality];

        const bars =
          quality === "good"
            ? 3
            : quality === "ok"
              ? 2
              : 1;

        const signal =
          this.add.graphics()
            .setPosition(COL_BARS, y);

        drawSignal(
          signal,
          16,
          bars,
          color
        );

        extras.push(
          signal,
          this.add.text(
            COL_PING,
            y,
            `${rtt}ms`,
            {
              fontSize: "14px",
              color: hex(color)
            }
          ).setOrigin(0, 0.5)
        );
      }

      text.setData(
        "extras",
        extras
      );

      this.playerTexts.set(
        player.id,
        text
      );
    }

    this.updateReadyButton();
    this.updateStartButton();
  }

  // ==========================================
  // READY BUTTON
  // ==========================================

  private updateReadyButton() {

    if (
      this.closing ||
      !this.readyButton ||
      !this.room
    ) {
      return;
    }

    const myPlayer =
      this.players.get(
        this.room.sessionId
      );

    if (!myPlayer) {
      return;
    }

    // Ready: the button turns green and offers to take it back.

    if (myPlayer.ready) {

      this.readyButton.setText(
        "UNREADY"
      );

      this.readyButton.setVariant(
        "success"
      );

    } else {

      this.readyButton.setText(
        "READY"
      );

      this.readyButton.setVariant(
        "primary"
      );
    }
  }

  // ==========================================
  // UPDATE START BUTTON
  // ==========================================

  private updateStartButton() {

    if (
      this.closing ||
      !this.startButton
    ) {
      return;
    }

    // Only the host sees the START button.

    const isHost =
      this.room?.sessionId ===
        this.hostId;

    this.startButton.setVisible(
      isHost
    );

    // Alone, READY sits in the middle; next to
    // START it takes the left side.

    this.readyButton?.setX(
      isHost
        ? READY_X
        : 400
    );

    if (!isHost) {
      return;
    }

    const playerList =
      Array.from(
        this.players.values()
      );

    const enoughPlayers =
      playerList.length >= 2;

    const everyoneReady =
      enoughPlayers &&
      playerList.every(
        player =>
          player.ready
      );

    if (everyoneReady) {

      this.startButton.setText(
        "START GAME"
      );

      this.startButton.setVariant(
        "primary"
      );

    } else {

      this.startButton.setText(
        "WAITING FOR PLAYERS"
      );

      this.startButton.setVariant(
        "neutral"
      );
    }
  }

  // ==========================================
  // CREATE LOBBY BUTTONS
  // ==========================================

  private createLobbyButtons() {

    // ----------------------------------------
    // READY BUTTON
    // ----------------------------------------

    this.readyButton =
      new UiButton(
        this,
        {
          x: READY_X,
          y: BUTTONS_Y,
          width: 255,
          height: 48,
          label: "READY",
          fontSize: 24,
          icon: "play",
          variant: "primary"
        }
      );

    juiceButton(
      this,
      this.readyButton
    );

    this.readyButton.on(
      "pointerdown",
      () => {

        if (!this.room) {
          return;
        }

        this.errorText.setText("");

        this.room.send(
          "toggleReady"
        );
      }
    );

    // ----------------------------------------
    // START BUTTON
    // ----------------------------------------

    this.startButton =
      new UiButton(
        this,
        {
          x: START_X,
          y: BUTTONS_Y,
          width: 289,
          height: 48,
          label: "WAITING FOR PLAYERS",
          fontSize: 16,
          icon: "people",
          variant: "neutral"
        }
      );

    juiceButton(
      this,
      this.startButton
    );

    this.startButton.on(
      "pointerdown",
      () => {

        if (!this.room) {
          return;
        }

        const playerList =
          Array.from(
            this.players.values()
          );

        const everyoneReady =
          playerList.length >= 2 &&
          playerList.every(
            player =>
              player.ready
          );

        if (!everyoneReady) {

          this.errorText.setText(
            "Everyone must be ready first."
          );

          return;
        }

        console.log(
          "Host clicked START GAME"
        );

        this.errorText.setText("");

        this.room.send(
          "startGame"
        );
      }
    );

    // ----------------------------------------
    // LEAVE BUTTON
    // ----------------------------------------

    this.leaveButton =
      new UiButton(
        this,
        {
          x: 400,
          y: 545,
          width: 140,
          height: 36,
          label: "LEAVE",
          fontSize: 15,
          icon: "exit",
          variant: "neutral",
          radius: 10
        }
      );

    juiceButton(
      this,
      this.leaveButton
    );

    this.leaveButton.on(
      "pointerdown",
      async () => {

        try {

          await this.network.leaveRoom();

        } catch (error) {

          console.error(
            "Error leaving room:",
            error
          );
        }

        this.scene.start(
          "MenuScene"
        );
      }
    );

    this.updateReadyButton();
    this.updateStartButton();
  }

  // ==========================================
  // BACK BUTTON (when the room could not be reached)
  // ==========================================

  private createBackButton() {

    const backButton =
      new UiButton(
        this,
        {
          x: 400,
          y: 500,
          width: 170,
          height: 44,
          label: "BACK",
          fontSize: 20,
          icon: "exit",
          variant: "neutral"
        }
      );

    juiceButton(
      this,
      backButton
    );

    backButton.on(
      "pointerdown",
      () => {

        this.scene.start(
          "MenuScene"
        );
      }
    );
  }

  // ==========================================
  // CLEAR LOBBY UI
  // ==========================================

  private clearLobbyUI() {

    for (
      const text
      of this.playerTexts.values()
    ) {

      const extras =
        text.getData(
          "extras"
        ) as
          | Phaser.GameObjects.GameObject[]
          | undefined;

      for (const extra of extras ?? []) {
        extra.destroy();
      }

      text.destroy();
    }

    this.playerTexts.clear();

    if (this.readyButton) {
      this.readyButton.destroy();
    }

    if (this.startButton) {
      this.startButton.destroy();
    }

    if (this.statusText) {
      this.statusText.destroy();
    }

    if (this.roomCodeText) {
      this.roomCodeText.destroy();
    }

    this.copyResetTimer?.remove(
      false
    );

    this.copyButton?.destroy();

    this.copyButton = null;

    if (this.errorText) {
      this.errorText.destroy();
    }
  }
}