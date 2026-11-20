import Phaser from "phaser";

import { audio } from "../audio/AudioManager";

import { SERVER_HTTP_URL } from "../config";

import {
  addMuteButton,
  juiceButton
} from "../effects";

import {
  formatNames,
  formatTime
} from "../format";

import { loadProfile } from "../profile";

// ==========================================
// LEADERBOARD: best level times
// ==========================================
//
// One board per level (and one for the whole game),
// optionally for one team size only: four players are
// not racing one. Data comes from the game server
// (GET /leaderboard); the times are counted by the
// server, not reported by the players.

interface Entry {
  level: number;
  ms: number;
  names: string[];
  size: number;
  at: number;
}

interface Response {
  boards: Record<string, Entry[]>;
  maxLevels: number;
  size: number;
}

// Which board: a level number, 0 = the whole game.
const FULL_RUN = 0;

const ROWS = 10;

const ROW_TOP = 222;

const ROW_STEP = 29;

// The table is 600 px wide, centred. Each column: x, the
// text's horizontal origin (0 = starts at x, 0.5 = centred
// on x) and its title.
const TABLE_WIDTH = 600;

const COLUMNS: [number, number, string][] = [
  [125, 0.5, "#"],
  [160, 0, "TIME"],
  [270, 0, "PLAYERS"],
  [560, 0.5, "TEAM"],
  [610, 0, "DATE"]
];

export class LeaderboardScene extends Phaser.Scene {

  private boards: Response | null = null;

  private level = 1;

  // 0 = every team size
  private size = 0;

  private loadingToken = 0;

  private tabButtons: Phaser.GameObjects.Text[] = [];

  private sizeButtons: Phaser.GameObjects.Text[] = [];

  private rows: Phaser.GameObjects.GameObject[] = [];

  private message!: Phaser.GameObjects.Text;

  private heading!: Phaser.GameObjects.Text;

  constructor() {
    super("LeaderboardScene");
  }

  init(
    data: {
      level?: number;
      size?: number;
    }
  ) {

    this.level = data?.level ?? 1;

    this.size = data?.size ?? 0;

    this.boards = null;

    this.tabButtons = [];

    this.sizeButtons = [];

    this.rows = [];
  }

  create() {

    this.cameras.main.setBackgroundColor("#202020");

    addMuteButton(this, 20, 575);

    this.add.text(
      400,
      42,
      "LEADERBOARD",
      {
        fontSize: "36px",
        color: "#ffffff",
        fontStyle: "bold"
      }
    ).setOrigin(0.5);

    this.add.text(
      400,
      78,
      "best times, counted by the server",
      {
        fontSize: "14px",
        color: "#888888"
      }
    ).setOrigin(0.5);

    // ---- which level ----

    const levels = [
      { label: "LEVEL 1", level: 1 },
      { label: "LEVEL 2", level: 2 },
      { label: "LEVEL 3", level: 3 },
      { label: "WHOLE GAME", level: FULL_RUN }
    ];

    let x = 165;

    for (const entry of levels) {

      const button =
        this.makeButton(
          x,
          116,
          entry.label,
          () => this.selectLevel(entry.level)
        );

      button.setData("level", entry.level);

      this.tabButtons.push(button);

      x += entry.level === 3 ? 165 : 110;
    }

    // ---- which team size ----

    this.add.text(
      150,
      160,
      "TEAM",
      {
        fontSize: "14px",
        color: "#888888"
      }
    ).setOrigin(0.5);

    const sizes = [
      { label: "ALL", size: 0 },
      { label: "1", size: 1 },
      { label: "2", size: 2 },
      { label: "3", size: 3 },
      { label: "4", size: 4 }
    ];

    x = 215;

    for (const entry of sizes) {

      const button =
        this.makeButton(
          x,
          160,
          entry.label,
          () => this.selectSize(entry.size),
          14
        );

      button.setData("size", entry.size);

      this.sizeButtons.push(button);

      x += 58;
    }

    this.add.text(
      545,
      160,
      "players",
      {
        fontSize: "14px",
        color: "#888888"
      }
    ).setOrigin(0, 0.5);

    // ---- table header ----

    // (the column titles are made with the rows)
    this.heading =
      this.add.text(
        400,
        196,
        "",
        {
          fontSize: "13px"
        }
      ).setVisible(false);

    this.message =
      this.add.text(
        400,
        340,
        "",
        {
          fontSize: "20px",
          color: "#aaaaaa",
          align: "center"
        }
      ).setOrigin(0.5);

    // ---- back ----

    const back =
      this.makeButton(
        400,
        560,
        "BACK",
        () => this.leave(),
        20
      );

    back.setPadding(34, 10, 34, 10);

    this.input.keyboard?.on(
      "keydown-ESC",
      () => this.leave()
    );

    this.input.keyboard?.on(
      "keydown-LEFT",
      () => this.step(-1)
    );

    this.input.keyboard?.on(
      "keydown-RIGHT",
      () => this.step(1)
    );

    this.refreshButtons();

    void this.fetchBoards();
  }

  // ========================================
  // BUTTONS
  // ========================================

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    fontSize = 16
  ): Phaser.GameObjects.Text {

    const button =
      this.add.text(
        x,
        y,
        label,
        {
          fontSize: `${fontSize}px`,
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 12,
            right: 12,
            top: 6,
            bottom: 6
          }
        }
      )
        .setOrigin(0.5)
        .setInteractive({
          useHandCursor: true
        });

    juiceButton(this, button);

    button.on("pointerdown", onClick);

    return button;
  }

  private refreshButtons() {

    for (const button of this.tabButtons) {

      const selected =
        button.getData("level") === this.level;

      button.setStyle({
        backgroundColor:
          selected
            ? "#336699"
            : "#444444"
      });
    }

    for (const button of this.sizeButtons) {

      const selected =
        button.getData("size") === this.size;

      button.setStyle({
        backgroundColor:
          selected
            ? "#336699"
            : "#444444"
      });
    }
  }

  private selectLevel(level: number) {

    if (level === this.level) {
      return;
    }

    this.level = level;

    this.refreshButtons();

    this.render();
  }

  private selectSize(size: number) {

    if (size === this.size) {
      return;
    }

    this.size = size;

    this.refreshButtons();

    void this.fetchBoards();
  }

  // The arrow keys move through the levels.

  private step(direction: number) {

    const order = [1, 2, 3, FULL_RUN];

    const index = order.indexOf(this.level);

    const next =
      order[
        (index + direction + order.length) %
          order.length
      ];

    this.selectLevel(next);
  }

  private leave() {

    audio.sfx("click");

    this.scene.start("MenuScene");
  }

  // ========================================
  // DATA
  // ========================================

  private async fetchBoards() {

    const token = ++this.loadingToken;

    this.boards = null;

    this.clearRows();

    this.message.setText("Loading...");

    try {

      const query =
        this.size > 0
          ? `?size=${this.size}`
          : "";

      const response =
        await fetch(
          `${SERVER_HTTP_URL}/leaderboard${query}`
        );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body =
        await response.json() as Response;

      // A newer request (another filter) took over.
      if (
        token !== this.loadingToken ||
        !this.scene.isActive()
      ) {
        return;
      }

      this.boards = body;

      this.render();

    } catch (error) {

      if (
        token !== this.loadingToken ||
        !this.scene.isActive()
      ) {
        return;
      }

      console.warn(
        "Leaderboard failed to load:",
        error
      );

      this.message.setText(
        "Could not load the leaderboard.\nClick here to try again."
      );

      this.message.setInteractive({
        useHandCursor: true
      });

      this.message.once(
        "pointerdown",
        () => {

          this.message.disableInteractive();

          void this.fetchBoards();
        }
      );
    }
  }

  // ========================================
  // TABLE
  // ========================================

  private clearRows() {

    for (const item of this.rows) {
      item.destroy();
    }

    this.rows = [];

    this.heading.setText("");
  }

  private render() {

    this.clearRows();

    if (!this.boards) {
      return;
    }

    const entries =
      this.boards.boards[String(this.level)] ?? [];

    if (entries.length === 0) {

      this.message.setText(
        this.size > 0
          ? `No ${this.size}-player times yet.\nBe the first!`
          : "No times yet.\nBe the first!"
      );

      return;
    }

    this.message.setText("");

    // Column titles, in the same places as the cells.
    for (const [x, originX, label] of COLUMNS) {

      this.rows.push(
        this.add.text(
          x,
          196,
          label,
          {
            fontSize: "13px",
            color: "#888888",
            fontStyle: "bold"
          }
        ).setOrigin(originX, 0.5)
      );
    }

    const mine =
      loadProfile().name.toLowerCase();

    entries
      .slice(0, ROWS)
      .forEach((entry, index) => {

        const y =
          ROW_TOP + index * ROW_STEP;

        const yours =
          mine !== "" &&
          entry.names.some(
            name =>
              name.toLowerCase() === mine
          );

        const color =
          yours
            ? "#ffdd66"
            : index === 0
              ? "#ffffff"
              : "#cccccc";

        const style = {
          fontSize: "17px",
          color,
          fontStyle:
            index === 0 || yours
              ? "bold"
              : "normal"
        };

        const stripe =
          this.add.rectangle(
            400,
            y,
            TABLE_WIDTH,
            ROW_STEP - 3,
            index % 2 === 0
              ? 0x2b2b2b
              : 0x252525,
            0.95
          ).setDepth(-1);

        this.rows.push(stripe);

        const cells: [number, number, string][] = [
          [COLUMNS[0][0], COLUMNS[0][1], index === 0 ? "★" : String(index + 1)],
          [COLUMNS[1][0], COLUMNS[1][1], formatTime(entry.ms)],
          [COLUMNS[2][0], COLUMNS[2][1], formatNames(entry.names, 24)],
          [COLUMNS[3][0], COLUMNS[3][1], `${entry.size}P`],
          [COLUMNS[4][0], COLUMNS[4][1], formatDate(entry.at)]
        ];

        for (const [x, originX, text] of cells) {

          this.rows.push(
            this.add.text(x, y, text, style)
              .setOrigin(originX, 0.5)
          );
        }
      });
  }
}

function formatDate(
  at: number
): string {

  try {

    return new Date(at).toLocaleDateString(
      undefined,
      { day: "numeric", month: "short" }
    );

  } catch {

    return "";
  }
}
