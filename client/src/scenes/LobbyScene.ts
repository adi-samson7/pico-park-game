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

  private mode: "create" | "join" = "create";

  private network!: NetworkManager;
  private room!: Room;

  private roomCode = "";

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
      mode: "create" | "join";
    }
  ) {
    this.mode = data.mode;
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
      // CREATE ROOM
      // ======================================

      if (this.mode === "create") {

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

    this.room.onMessage(
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
        this.updateStartButton();
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
        this.updateStartButton();
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
        this.updateStartButton();
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
        this.updateStartButton();
      }
    );

    // ----------------------------------------
    // ALL PLAYERS READY
    // ----------------------------------------

    this.room.onMessage(
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

    this.room.onMessage(
      "gameStarted",
      () => {

        console.log(
          "Game started!"
        );

        const players =
          Array.from(
            this.players.values()
          );

        const myPlayer =
          this.players.get(
            this.room.sessionId
          );

        console.log(
          "Sending players to GameScene:",
          players
        );

        console.log(
          "My player:",
          myPlayer
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
    );

    // ----------------------------------------
    // HOST CHANGED
    // ----------------------------------------

    this.room.onMessage(
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

    this.room.onMessage(
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
    // DISCONNECTED FROM SERVER
    // ----------------------------------------

    this.room.onLeave(
      () => {

        if (
          this.scene.isActive(
            "LobbyScene"
          )
        ) {

          this.scene.start(
            "MenuScene"
          );
        }
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

    const sortedPlayers =
      Array.from(
        this.players.values()
      ).sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      );

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

      const text =
        this.add.text(
          400,
          275 +
            player.playerIndex * 50,
          `${playerName}    ${status}`,
          {
            fontSize: "21px",
            color: textColor,
            fontStyle:
              isMe
                ? "bold"
                : "normal"
          }
        ).setOrigin(0.5);

      const indicator =
        this.add.circle(
          175,
          287 +
            player.playerIndex * 50,
          8,
          player.color
        );

      text.setData(
        "indicator",
        indicator
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

    if (this.startButton) {
      this.startButton.destroy();
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