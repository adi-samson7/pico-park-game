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

  private roomCode =
    "";

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
    // CREATE OR JOIN
    // ----------------------------------------

    try {

      this.network =
        new NetworkManager();

      if (
        this.mode === "create"
      ) {

        // -------------------------------
        // CREATE ROOM
        // -------------------------------

        this.room =
          await this.network.createRoom();

        this.statusText.setText(
          "Room created!"
        );

        this.setupRoomListeners();

        this.createLobbyButtons();

      } else {

        // -------------------------------
        // JOIN ROOM
        // -------------------------------

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
  }

  // ==========================================
  // UPDATE PLAYER LIST
  // ==========================================

  private updatePlayerList() {

    // ----------------------------------------
    // REMOVE OLD TEXT
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

      const color =
        player.ready
          ? "#66ff66"
          : "#aaaaaa";

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
            color: color
          }
        ).setOrigin(0.5);

      this.playerTexts.set(
        player.id,
        text
      );
    }
  }

  // ==========================================
  // CREATE BUTTONS
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

        this.readyButton.setStyle({
          backgroundColor:
            "#666666"
        });
      }
    );

    this.readyButton.on(
      "pointerout",
      () => {

        this.readyButton.setStyle({
          backgroundColor:
            "#444444"
        });
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
      "pointerdown",
      async () => {

        await this.network.leaveRoom();

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
}