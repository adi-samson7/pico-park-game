import Phaser from "phaser";

import { audio } from "../audio/AudioManager";

import { controls } from "../input/Controls";

import { drawPanel } from "./draw";

import { drawIcon } from "./icons";

import {
  COLOR,
  FONT_BODY
} from "./theme";

import { UiButton } from "./UiButton";

// ==========================================
// SETTINGS MENU (in the game)
// ==========================================
//
// Opens over the game with Escape or the cog. The game keeps
// running (other players are not waiting for you), but your
// own movement keys are off while it is open.
//
//   SOUND    on / off (the same as the M key)
//   MUSIC    volume, 0 to 100 %
//   EFFECTS  volume, 0 to 100 %
//   RESUME   close the menu
//   EXIT     leave the game and go back to the main menu (after
//            asking: it leaves your team without you)

const DEPTH = 700;

// the panel
const PANEL_X = 400;

const PANEL_Y = 290;

const PANEL_WIDTH = 460;

const PANEL_HEIGHT = 390;

const LEFT = PANEL_X - PANEL_WIDTH / 2 + 36;

// sliders
const TRACK_LEFT = 318;

const TRACK_WIDTH = 220;

export class SettingsPanel {

  private readonly root:
    Phaser.GameObjects.Container;

  // what is shown in each of the two views
  private readonly mainView:
    Phaser.GameObjects.GameObject[] = [];

  private readonly confirmView:
    Phaser.GameObjects.GameObject[] = [];

  private soundButton!: UiButton;

  private keyText!:
    Phaser.GameObjects.Text;

  private sliders:
    Array<() => void> = [];

  private confirming = false;

  private opened = false;

  private readonly stopMuteWatch:
    () => void;

  private readonly keyTimer:
    Phaser.Time.TimerEvent;

  constructor(
    private readonly scene:
      Phaser.Scene,

    private readonly onExit:
      () => void
  ) {

    this.root =
      scene.add.container(0, 0)
        .setDepth(DEPTH)
        .setVisible(false);

    // Everything behind the menu is covered, and clicks do not
    // reach it.
    const veil =
      scene.add.rectangle(
        400,
        300,
        800,
        600,
        0x000000,
        0.66
      ).setInteractive();

    this.root.add(veil);

    const panel =
      scene.add.graphics();

    drawPanel(
      panel,
      PANEL_X,
      PANEL_Y,
      PANEL_WIDTH,
      PANEL_HEIGHT,
      {
        fill: COLOR.panel,
        stroke: COLOR.stroke,
        strokeWidth: 2,
        radius: 16,
        glow: 8,
        glowStrength: 0.35
      }
    );

    this.root.add(panel);

    this.buildMainView();

    this.buildConfirmView();

    this.showView("main");

    this.stopMuteWatch =
      audio.onMuteChange(
        () => this.refresh()
      );

    // what the last key looked like (to find out why a key
    // does not work)
    this.keyTimer =
      scene.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {

          if (this.opened) {
            this.refreshKeyText();
          }
        }
      });
  }

  // ========================================
  // OPEN / CLOSE
  // ========================================

  get isOpen(): boolean {
    return this.opened;
  }

  open() {

    if (this.opened) {
      return;
    }

    this.opened = true;

    this.confirming = false;

    this.showView("main");

    this.refresh();

    this.root.setVisible(true);

    // Your own movement keys are off while the menu is open.
    controls.setGameInput(false);
  }

  close() {

    if (!this.opened) {
      return;
    }

    this.opened = false;

    this.root.setVisible(false);

    controls.setGameInput(true);
  }

  /** Escape: open it, back out of "leave the game?", or close it. */
  toggle() {

    if (!this.opened) {

      this.open();

    } else if (this.confirming) {

      this.confirming = false;

      this.showView("main");

    } else {

      this.close();
    }
  }

  destroy() {

    this.stopMuteWatch();

    this.keyTimer.remove(false);

    if (this.opened) {
      controls.setGameInput(true);
    }

    this.opened = false;

    this.root.destroy();
  }

  // ========================================
  // THE TWO VIEWS
  // ========================================

  private showView(
    view: "main" | "confirm"
  ) {

    this.confirming =
      view === "confirm";

    for (const item of this.mainView) {
      (item as any).setVisible?.(view === "main");
    }

    for (const item of this.confirmView) {
      (item as any).setVisible?.(view === "confirm");
    }
  }

  private add<
    T extends Phaser.GameObjects.GameObject
  >(
    list: Phaser.GameObjects.GameObject[],
    item: T
  ): T {

    this.root.add(item);

    list.push(item);

    return item;
  }

  private text(
    list: Phaser.GameObjects.GameObject[],
    x: number,
    y: number,
    content: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    originX = 0
  ) {

    return this.add(
      list,
      this.scene.add.text(
        x,
        y,
        content,
        {
          fontFamily: FONT_BODY,
          ...style
        }
      ).setOrigin(originX, 0.5)
    );
  }

  // ========================================
  // MAIN VIEW
  // ========================================

  private buildMainView() {

    const list = this.mainView;

    this.text(
      list,
      PANEL_X,
      PANEL_Y - 152,
      "SETTINGS",
      {
        fontSize: "26px",
        fontStyle: "bold",
        color: COLOR.textBright
      },
      0.5
    );

    // ---- sound on / off ----

    this.text(
      list,
      LEFT,
      PANEL_Y - 98,
      "SOUND",
      {
        fontSize: "17px",
        fontStyle: "bold",
        color: COLOR.textSoft
      }
    );

    this.soundButton =
      this.add(
        list,
        new UiButton(
          this.scene,
          {
            x: PANEL_X + PANEL_WIDTH / 2 - 36 - 62,
            y: PANEL_Y - 98,
            width: 124,
            height: 34,
            label: "ON",
            fontSize: 16,
            icon: "speaker",
            variant: "success",
            radius: 9
          }
        )
      );

    this.soundButton.on(
      "pointerdown",
      () => {

        audio.toggleMute();

        audio.sfx("click");
      }
    );

    // ---- volumes ----

    this.buildSlider(
      list,
      PANEL_Y - 48,
      "MUSIC",
      () => audio.musicLevel,
      (value) => audio.setMusicLevel(value),
      false
    );

    this.buildSlider(
      list,
      PANEL_Y + 2,
      "EFFECTS",
      () => audio.sfxLevel,
      (value) => audio.setSfxLevel(value),
      true
    );

    // ---- the keys ----

    const keys =
      this.add(
        list,
        this.scene.add.graphics()
      );

    drawPanel(
      keys,
      PANEL_X,
      PANEL_Y + 78,
      PANEL_WIDTH - 72,
      74,
      {
        fill: COLOR.panelDeep,
        stroke: COLOR.strokeSoft,
        strokeWidth: 1,
        radius: 10
      }
    );

    this.text(
      list,
      LEFT + 14,
      PANEL_Y + 56,
      "Move   A D  or  ← →        Jump   W  Space  or  ↑",
      {
        fontSize: "12px",
        color: COLOR.textSoft
      }
    );

    this.text(
      list,
      LEFT + 14,
      PANEL_Y + 76,
      "Menu   Esc                 Sound  M",
      {
        fontSize: "12px",
        color: COLOR.textSoft
      }
    );

    this.keyText =
      this.text(
        list,
        LEFT + 14,
        PANEL_Y + 98,
        "last key: (press any key)",
        {
          fontSize: "11px",
          color: COLOR.textFaint
        }
      );

    // ---- buttons ----

    const resume =
      this.add(
        list,
        new UiButton(
          this.scene,
          {
            x: PANEL_X - 105,
            y: PANEL_Y + 158,
            width: 190,
            height: 44,
            label: "RESUME",
            fontSize: 18,
            icon: "play",
            variant: "primary"
          }
        )
      );

    resume.on(
      "pointerdown",
      () => this.close()
    );

    const exit =
      this.add(
        list,
        new UiButton(
          this.scene,
          {
            x: PANEL_X + 105,
            y: PANEL_Y + 158,
            width: 190,
            height: 44,
            label: "EXIT GAME",
            fontSize: 18,
            icon: "exit",
            variant: "neutral"
          }
        )
      );

    exit.on(
      "pointerdown",
      () => {

        audio.sfx("click");

        this.showView("confirm");
      }
    );
  }

  // A slider: a track, a knob, and the value as a percentage.
  // Click or drag on the track.

  private buildSlider(
    list: Phaser.GameObjects.GameObject[],
    y: number,
    label: string,
    get: () => number,
    set: (value: number) => void,
    previewOnRelease: boolean
  ) {

    this.text(
      list,
      LEFT,
      y,
      label,
      {
        fontSize: "17px",
        fontStyle: "bold",
        color: COLOR.textSoft
      }
    );

    const graphics =
      this.add(
        list,
        this.scene.add.graphics()
      );

    const percent =
      this.text(
        list,
        TRACK_LEFT + TRACK_WIDTH + 18,
        y,
        "",
        {
          fontSize: "15px",
          fontStyle: "bold",
          color: COLOR.text
        }
      );

    const draw = () => {

      const value = get();

      const muted = audio.isMuted;

      graphics.clear();

      // the track
      graphics.fillStyle(0x262a44, 1);

      graphics.fillRoundedRect(
        TRACK_LEFT,
        y - 4,
        TRACK_WIDTH,
        8,
        4
      );

      // the filled part
      graphics.fillStyle(
        muted
          ? 0x4a4f78
          : COLOR.blue,
        1
      );

      graphics.fillRoundedRect(
        TRACK_LEFT,
        y - 4,
        Math.max(8, TRACK_WIDTH * value),
        8,
        4
      );

      // the knob
      graphics.fillStyle(
        muted
          ? 0x9aa0c4
          : 0xffffff,
        1
      );

      graphics.fillCircle(
        TRACK_LEFT + TRACK_WIDTH * value,
        y,
        10
      );

      percent.setText(
        `${Math.round(value * 100)}%`
      );

      percent.setAlpha(
        muted ? 0.5 : 1
      );
    };

    this.sliders.push(draw);

    // a hit area a little bigger than the track
    const zone =
      this.add(
        list,
        this.scene.add.rectangle(
          TRACK_LEFT + TRACK_WIDTH / 2,
          y,
          TRACK_WIDTH + 28,
          30,
          0xffffff,
          0.001
        ).setInteractive({
          useHandCursor: true
        })
      );

    let dragging = false;

    const move = (
      pointer: Phaser.Input.Pointer
    ) => {

      // (the pointer in game coordinates: right even when the
      // canvas is shown smaller)
      set(
        (pointer.worldX - TRACK_LEFT) /
          TRACK_WIDTH
      );

      draw();
    };

    zone.on(
      "pointerdown",
      (pointer: Phaser.Input.Pointer) => {

        dragging = true;

        move(pointer);
      }
    );

    this.scene.input.on(
      "pointermove",
      (pointer: Phaser.Input.Pointer) => {

        if (dragging) {
          move(pointer);
        }
      }
    );

    this.scene.input.on(
      "pointerup",
      () => {

        if (!dragging) {
          return;
        }

        dragging = false;

        // so you can hear what the level sounds like
        if (previewOnRelease) {
          audio.sfx("crystal");
        }
      }
    );
  }

  // ========================================
  // CONFIRM VIEW ("leave the game?")
  // ========================================

  private buildConfirmView() {

    const list = this.confirmView;

    const icon =
      this.add(
        list,
        this.scene.add.graphics()
          .setPosition(PANEL_X, PANEL_Y - 96)
      );

    drawIcon(
      icon,
      "exit",
      46,
      0xffb070
    );

    this.text(
      list,
      PANEL_X,
      PANEL_Y - 40,
      "LEAVE THE GAME?",
      {
        fontSize: "26px",
        fontStyle: "bold",
        color: COLOR.textBright
      },
      0.5
    );

    this.text(
      list,
      PANEL_X,
      PANEL_Y + 8,
      "Your team keeps playing without you.\nYou cannot rejoin this game once you leave.",
      {
        fontSize: "14px",
        color: COLOR.textSoft,
        align: "center",
        lineSpacing: 6
      },
      0.5
    );

    const stay =
      this.add(
        list,
        new UiButton(
          this.scene,
          {
            x: PANEL_X - 105,
            y: PANEL_Y + 100,
            width: 190,
            height: 46,
            label: "STAY",
            fontSize: 18,
            icon: "play",
            variant: "primary"
          }
        )
      );

    stay.on(
      "pointerdown",
      () => this.showView("main")
    );

    const leave =
      this.add(
        list,
        new UiButton(
          this.scene,
          {
            x: PANEL_X + 105,
            y: PANEL_Y + 100,
            width: 190,
            height: 46,
            label: "LEAVE",
            fontSize: 18,
            icon: "exit",
            variant: "warn"
          }
        )
      );

    leave.on(
      "pointerdown",
      () => {

        this.close();

        this.onExit();
      }
    );
  }

  // ========================================
  // WHAT IS SHOWN
  // ========================================

  private refresh() {

    if (!this.soundButton?.active) {
      return;
    }

    this.soundButton.setText(
      audio.isMuted
        ? "OFF"
        : "ON"
    );

    this.soundButton.setVariant(
      audio.isMuted
        ? "neutral"
        : "success"
    );

    for (const draw of this.sliders) {
      draw();
    }

    this.refreshKeyText();
  }

  private refreshKeyText() {

    if (!this.keyText?.active) {
      return;
    }

    this.keyText.setText(
      controls.lastKey
        ? `last key: ${controls.lastKey}`
        : "last key: (press any key)"
    );
  }
}
