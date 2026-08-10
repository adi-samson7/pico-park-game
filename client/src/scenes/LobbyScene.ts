import Phaser from "phaser";
import { Room } from "@colyseus/sdk";

import { NetworkManager } from "../network/NetworkManager";

interface PlayerData {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
  color: number;
  ready: boolean;
}

export class LobbyScene extends Phaser.Scene {

  private mode:
    "create" | "join" =
    "create";

  private network!: NetworkManager;

  private room!: Room;

  private roomCode = "";

  private players:
    Map<string, PlayerData> =
    new Map();

  private playerTexts:
    Map<string, Phaser.GameObjects.Text> =
    new Map();

  private readyButton!:
    Phaser.GameObjects.Text;

  private statusText!:
    Phaser.GameObjects.Text;

  private roomCodeText!:
    Phaser.GameObjects.Text;

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
      mode:
        "create" | "join";
    }
  ) {

    this.mode =
      data.mode;
  }

  // ==========================================
  // CREATE
  // ==========================================

  async create() {

    this.cameras.main.setBackgroundColor(
      "#202020"
    );

    // ----------------------------------------
    // TITLE
    // ----------------------------------------

    this.add.text(
      400,
      60,
      "PICO CO-OP",
      {
        fontSize: "42px",
        color: "#ffffff",
        fontStyle: "bold"
      }
    ).setOrigin(0.5);

    this.add.text(
      400,
      110,
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
        160,
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
        210,
        "",
        {
          fontSize: "26px",
          color: "#ffffff",
          fontStyle: "bold"
        }
      ).setOrigin(0.5);

    // ----------------------------------------
    // ERROR
    // ----------------------------------------

    this.errorText =
      this.add.text(
        400,
        245,
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
      // CREATE ROOM
      // ======================================

      if (
        this.mode === "create"
      ) {

        this.statusText.setText(
          "Creating room..."
        );

        this.room =
          await this.network.createRoom();

        this.statusText.setText(
          "Room created!"
        );

        this.setupRoomListeners();

        this.createLobbyButtons();

      }

      // ======================================
      // JOIN ROOM
      // ======================================

      else {

        const code =
          window.prompt(
            "Enter the 6-character room code:"
          );

        // User cancelled.

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
            code
          );

        this.statusText.setText(
          "Joined room!"
        );

        this.setupRoomListeners();

        this.createLobbyButtons();
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
    // ROOM INFO
    // ----------------------------------------

    this.room.onMessage(
      "roomInfo",
      (data: {
        roomId: string;
        roomCode: string;
      }) => {

        console.log(
          "Room info:",
          data
        );

        this.roomCode =
          data.roomCode;

        this.roomCodeText.setText(
          `ROOM CODE: ${data.roomCode}`
        );
      }
    );

    // ----------------------------------------
    // MY PLAYER
    // ----------------------------------------

    this.room.onMessage(
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

        this.players.set(
          player.id,
          player
        );

        this.updatePlayerList();
      }
    );

    // ----------------------------------------
    // READY CHANGED
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

        const player =
          this.players.get(
            data.id
          );

        if (!player) {
          return;
        }

        player.ready =
          data.ready;

        this.players.set(
          data.id,
          player
        );

        this.updatePlayerList();
      }
    );

    // ----------------------------------------
    // PLAYER LEFT
    // ----------------------------------------

    this.room.onMessage(
      "playerLeft",
      (data: {
        id: string;
      }) => {

        console.log(
          "Player left:",
          data.id
        );

        this.players.delete(
          data.id
        );

        this.updatePlayerList();
      }
    );

    // ----------------------------------------
    // GAME STARTED
    // ----------------------------------------

    this.room.onMessage(
      "gameStarted",
      (data: {
        roomId: string;
        roomCode: string;
      }) => {

        console.log(
          "Game started!",
          data
        );

        // Remove lobby UI.

        this.clearLobbyUI();

        // Move all players
        // into GameScene.

        this.scene.start(
          "GameScene"
        );
      }
    );
  }

  // ==========================================
  // UPDATE PLAYER LIST
  // ==========================================

  private updatePlayerList() {

    // ----------------------------------------
    // REMOVE OLD PLAYER TEXT
    // ----------------------------------------

    for (
      const text
      of this.playerTexts.values()
    ) {

      text.destroy();
    }

    this.playerTexts.clear();

    // ----------------------------------------
    // SORT PLAYERS
    // ----------------------------------------

    const sortedPlayers =
      Array.from(
        this.players.values()
      ).sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      );

    // ----------------------------------------
    // DISPLAY PLAYERS
    // ----------------------------------------

    for (
      const player
      of sortedPlayers
    ) {

      const status =
        player.ready
          ? "READY"
          : "NOT READY";

      const textColor =
        player.ready
          ? "#66ff66"
          : "#aaaaaa";

      const playerColor =
        Phaser.Display.Color.IntegerToColor(
          player.color
        );

      const colorHex =
        playerColor.color;

      const text =
        this.add.text(
          400,
          285 +
            player.playerIndex *
            50,
          `Player ${
            player.playerIndex + 1
          }     ${status}`,
          {
            fontSize: "22px",
            color: textColor,
            fontStyle:
              player.id ===
              this.room?.sessionId
                ? "bold"
                : "normal"
          }
        ).setOrigin(0.5);

      // Small color indicator.

      const indicator =
        this.add.circle(
          270,
          297 +
            player.playerIndex *
            50,
          8,
          colorHex
        );

      // Store only text because
      // playerTexts is used for cleanup.

      this.playerTexts.set(
        player.id,
        text
      );

      // Prevent unused indicator
      // from causing cleanup issues
      // by attaching it to the text.

      text.setData(
        "indicator",
        indicator
      );
    }

    // Update our button.

    this.updateReadyButton();
  }

  // ==========================================
  // UPDATE READY BUTTON
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
  // CREATE LOBBY BUTTONS
  // ==========================================

  private createLobbyButtons() {

    // ----------------------------------------
    // READY BUTTON
    // ----------------------------------------

    this.readyButton =
      this.add.text(
        400,
        500,
        "READY",
        {
          fontSize: "24px",
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 35,
            right: 35,
            top: 12,
            bottom: 12
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

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

        this.room.send(
          "toggleReady"
        );
      }
    );

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

      const indicator =
        text.getData(
          "indicator"
        ) as
          | Phaser.GameObjects.Arc
          | undefined;

      if (indicator) {
        indicator.destroy();
      }

      text.destroy();
    }

    this.playerTexts.clear();

    if (this.readyButton) {
      this.readyButton.destroy();
    }

    if (this.statusText) {
      this.statusText.destroy();
    }

    if (this.roomCodeText) {
      this.roomCodeText.destroy();
    }

    if (this.errorText) {
      this.errorText.destroy();
    }
  }
}