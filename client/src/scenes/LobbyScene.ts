import Phaser from "phaser";
import { Room } from "@colyseus/sdk";
import { NetworkManager } from "../network/NetworkManager";
import { audio } from "../audio/AudioManager";
import { ConnectionHud } from "../net/ConnectionHud";
import { tabSession } from "../net/session";
import { copyToClipboard } from "../net/clipboard";
import { QUALITY_COLORS, qualityOf } from "../net/latency";

// Roster table (game coordinates).
const ROW_TOP = 275;
const ROW_STEP = 50;
const ROW_WIDTH = 580;
const ROW_HEIGHT = 40;
const COL_DOT = 138;
const COL_NAME = 162;
const COL_STATUS = 482;
const COL_PING = 676;
const SLOTS = 4;

const hex = (color: number) =>
  "#" + color.toString(16).padStart(6, "0");
import {
  addMuteButton,
  juiceButton
} from "../effects";

interface PlayerData {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
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

  private readyButton!:
    Phaser.GameObjects.Text;

  private startButton!:
    Phaser.GameObjects.Text;

  private statusText!:
    Phaser.GameObjects.Text;

  private roomCodeText!:
    Phaser.GameObjects.Text;

  // "COPY" next to the room code.
  private copyButton:
    Phaser.GameObjects.Text | null = null;

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

    this.copyButton = null;

    this.copyResetTimer = null;

    this.players = new Map();

    this.playerTexts = new Map();
  }

  // ==========================================
  // CREATE
  // ==========================================

  async create() {

    this.cameras.main.setBackgroundColor(
      "#202020"
    );

    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.teardown()
    );

    addMuteButton(
      this,
      20,
      575
    );

    audio.playMusic(
      "menu"
    );

    // ----------------------------------------
    // TITLE
    // ----------------------------------------

    this.add.text(
      400,
      50,
      "PICO CO-OP",
      {
        fontSize: "42px",
        color: "#ffffff",
        fontStyle: "bold"
      }
    ).setOrigin(0.5);

    this.add.text(
      400,
      100,
      "LOBBY",
      {
        fontSize: "28px",
        color: "#aaaaaa"
      }
    ).setOrigin(0.5);

    // ----------------------------------------
    // STATUS
    // ----------------------------------------

    this.statusText =
      this.add.text(
        400,
        145,
        "Connecting...",
        {
          fontSize: "20px",
          color: "#cccccc"
        }
      ).setOrigin(0.5);

    // ----------------------------------------
    // ROOM CODE
    // ----------------------------------------

    this.roomCodeText =
      this.add.text(
        400,
        190,
        "ROOM CODE: ------",
        {
          fontSize: "26px",
          color: "#ffffff",
          fontStyle: "bold"
        }
      ).setOrigin(0.5);

    // ----------------------------------------
    // COPY ROOM CODE
    // ----------------------------------------
    //
    // Appears once the code is known. Clicking
    // it (or the code itself) copies the code
    // so it can be pasted to friends.

    this.copyButton =
      this.add.text(
        548,
        190,
        "COPY",
        {
          fontSize: "16px",
          color: "#ffffff",
          backgroundColor: "#446688",

          // A fixed width, so the button does not
          // change size (and shove the code
          // aside) when it says COPIED!
          fixedWidth: 130,
          align: "center",

          padding: {
            left: 0,
            right: 0,
            top: 6,
            bottom: 6
          }
        }
      )
        .setOrigin(0, 0.5)
        .setVisible(false)
        .setInteractive({
          useHandCursor: true
        });

    this.layoutRoomCode();

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
    // ERROR
    // ----------------------------------------

    this.errorText =
      this.add.text(
        400,
        225,
        "",
        {
          fontSize: "18px",
          color: "#ff6666"
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
          await this.network.createRoom();

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
            code.trim().toUpperCase()
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
          `ROOM CODE: ${data.roomCode}`
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
      "resync",
      (data: ResyncData) => {

        this.applyResync(
          data
        );
      }
    );
  }

  // ==========================================
  // ROOM CODE LAYOUT
  // ==========================================

  // The code and its COPY button are centred
  // as one group.

  private layoutRoomCode() {

    if (!this.roomCodeText) {
      return;
    }

    const gap = 16;

    const codeWidth =
      this.roomCodeText.width;

    const showCopy =
      !!this.copyButton?.visible;

    const total =
      codeWidth +
      (showCopy
        ? gap + this.copyButton!.width
        : 0);

    const left =
      400 - total / 2;

    this.roomCodeText
      .setOrigin(0, 0.5)
      .setPosition(left, 190);

    this.copyButton
      ?.setOrigin(0, 0.5)
      .setPosition(
        left + codeWidth + gap,
        190
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

    this.copyButton.setStyle({
      backgroundColor:
        copied
          ? "#226622"
          : "#884422"
    });

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

          this.copyButton.setStyle({
            backgroundColor:
              "#446688"
          });

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
      `ROOM CODE: ${data.roomCode}`
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

    // One row per seat, taken or not: the
    // table keeps its shape and shows how many
    // players fit.

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

      // ---- empty seat ----

      if (!player) {

        extras.push(
          this.add.rectangle(
            400,
            y,
            ROW_WIDTH,
            ROW_HEIGHT,
            0x262626,
            0.6
          ).setDepth(-1)
        );

        const empty =
          this.add.text(
            COL_NAME,
            y,
            "waiting for player...",
            {
              fontSize: "18px",
              color: "#555555",
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

      const status =
        away
          ? "RECONNECTING..."
          : player.ready
            ? "READY"
            : "NOT READY";

      const statusColor =
        away
          ? "#ffcc66"
          : player.ready
            ? "#66ff66"
            : "#999999";

      const rtt =
        away
          ? null
          : this.hud?.rttOf(
              player.id
            ) ?? null;

      const isHost =
        player.id === this.hostId;

      const isMe =
        player.id ===
        this.room?.sessionId;

      let playerName =
        `Player ${
          player.playerIndex + 1
        }`;

      if (isHost) {
        playerName +=
          " [HOST]";
      }

      if (isMe) {
        playerName +=
          " (YOU)";
      }

      // row background (yours is outlined)

      const background =
        this.add.rectangle(
          400,
          y,
          ROW_WIDTH,
          ROW_HEIGHT,
          0x2e2e2e,
          0.95
        ).setDepth(-1);

      if (isMe) {

        background.setStrokeStyle(
          2,
          0x6699ff
        );
      }

      extras.push(background);

      // colour dot, centred on the row

      extras.push(
        this.add.circle(
          COL_DOT,
          y,
          9,
          player.color
        )
      );

      // name

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
                : "#cccccc",
            fontStyle:
              isMe
                ? "bold"
                : "normal"
          }
        ).setOrigin(0, 0.5);

      // status, in its own column

      extras.push(
        this.add.text(
          COL_STATUS,
          y,
          status,
          {
            fontSize: "19px",
            color: statusColor,
            fontStyle: "bold"
          }
        ).setOrigin(0, 0.5)
      );

      // ping, right-aligned, coloured by quality

      if (rtt !== null) {

        extras.push(
          this.add.text(
            COL_PING,
            y,
            `${rtt} ms`,
            {
              fontSize: "16px",
              color:
                hex(
                  QUALITY_COLORS[
                    qualityOf(rtt)
                  ]
                )
            }
          ).setOrigin(1, 0.5)
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

    if (myPlayer.ready) {

      this.readyButton.setText(
        "UNREADY"
      );

      this.readyButton.setStyle({
        backgroundColor:
          "#226622"
      });

    } else {

      this.readyButton.setText(
        "READY"
      );

      this.readyButton.setStyle({
        backgroundColor:
          "#444444"
      });
    }
  }

  // ==========================================
  // UPDATE START BUTTON
  // ==========================================

  private updateStartButton() {

    if (
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
        ? 250
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

      this.startButton.setStyle({
        backgroundColor:
          "#226622"
      });

    } else {

      this.startButton.setText(
        "WAITING FOR PLAYERS"
      );

      this.startButton.setStyle({
        backgroundColor:
          "#444444"
      });
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
      this.add.text(
        250,
        500,
        "READY",
        {
          fontSize: "22px",
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 25,
            right: 25,
            top: 12,
            bottom: 12
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

    juiceButton(
      this,
      this.readyButton
    );

    this.readyButton.on(
      "pointerover",
      () => {

        const myPlayer =
          this.players.get(
            this.room.sessionId
          );

        if (
          myPlayer?.ready
        ) {
          return;
        }

        this.readyButton.setStyle({
          backgroundColor:
            "#666666"
        });
      }
    );

    this.readyButton.on(
      "pointerout",
      () => {

        this.updateReadyButton();
      }
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

    {

      this.startButton =
        this.add.text(
          550,
          500,
          "WAITING FOR PLAYERS",
          {
            fontSize: "20px",
            color: "#ffffff",
            backgroundColor: "#444444",
            padding: {
              left: 20,
              right: 20,
              top: 12,
              bottom: 12
            }
          }
        )
        .setOrigin(0.5)
        .setInteractive({
          useHandCursor: true
        });

      juiceButton(
        this,
        this.startButton
      );

      this.startButton.on(
        "pointerover",
        () => {

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

          if (everyoneReady) {

            this.startButton.setStyle({
              backgroundColor:
                "#338833"
            });
          }
        }
      );

      this.startButton.on(
        "pointerout",
        () => {

          this.updateStartButton();
        }
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
    }

    // ----------------------------------------
    // LEAVE BUTTON
    // ----------------------------------------

    const leaveButton =
      this.add.text(
        400,
        570,
        "LEAVE",
        {
          fontSize: "18px",
          color: "#ffffff",
          backgroundColor: "#333333",
          padding: {
            left: 25,
            right: 25,
            top: 8,
            bottom: 8
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

    juiceButton(
      this,
      leaveButton
    );

    leaveButton.on(
      "pointerover",
      () => {

        leaveButton.setStyle({
          backgroundColor:
            "#555555"
        });
      }
    );

    leaveButton.on(
      "pointerout",
      () => {

        leaveButton.setStyle({
          backgroundColor:
            "#333333"
        });
      }
    );

    leaveButton.on(
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
  // BACK BUTTON
  // ==========================================

  private createBackButton() {

    const backButton =
      this.add.text(
        400,
        500,
        "BACK",
        {
          fontSize: "24px",
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 30,
            right: 30,
            top: 12,
            bottom: 12
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

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