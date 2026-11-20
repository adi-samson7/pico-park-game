import Phaser from "phaser";

import { drawPanel } from "./draw";

import {
  drawIcon,
  type IconName
} from "./icons";

import {
  COLOR,
  FONT_BODY
} from "./theme";

// ==========================================
// BUTTON
// ==========================================
//
// A rounded panel with an icon and a label. One object, so
// it can be shown, hidden, moved and clicked as a whole.
//
//   primary  solid blue: the thing to do next
//   accent   dark with a glowing blue edge
//   neutral  dark with a grey edge
//   success  green: it is switched on
//   warn     amber: something did not work
//   muted    greyed, the thing is not possible yet

export type Variant =
  | "primary"
  | "accent"
  | "neutral"
  | "success"
  | "warn"
  | "muted";

export interface UiButtonOptions {

  // centre
  x: number;
  y: number;

  width: number;
  height: number;

  label: string;

  fontSize?: number;

  icon?: IconName;

  // "inline": the icon sits right before the label, both
  //           centred
  // "edge":   the icon at the left edge, the label
  //           centred, a chevron at the right edge
  layout?: "inline" | "edge";

  variant?: Variant;

  radius?: number;
}

interface Look {
  fill: number;
  fillHover: number;
  stroke: number;
  strokeHover: number;
  glow: number;
  text: string;
  icon: number;
}

const LOOKS: Record<Variant, Look> = {

  primary: {
    fill: 0x2459e6,
    fillHover: 0x3a6dff,
    stroke: 0x6a95ff,
    strokeHover: 0x9ab6ff,
    glow: 10,
    text: "#ffffff",
    icon: 0xffffff
  },

  accent: {
    fill: 0x12162e,
    fillHover: 0x1a2142,
    stroke: 0x3f78ff,
    strokeHover: 0x7ca3ff,
    glow: 9,
    text: "#ffffff",
    icon: 0xffffff
  },

  neutral: {
    fill: 0x181b30,
    fillHover: 0x22263f,
    stroke: 0x3b4163,
    strokeHover: 0x5a628c,
    glow: 0,
    text: "#d5d9f5",
    icon: 0xd5d9f5
  },

  success: {
    fill: 0x1b7a45,
    fillHover: 0x23955a,
    stroke: 0x59e08e,
    strokeHover: 0x8af0b2,
    glow: 8,
    text: "#ffffff",
    icon: 0xffffff
  },

  warn: {
    fill: 0x6b3a1c,
    fillHover: 0x824924,
    stroke: 0xff9a55,
    strokeHover: 0xffb98a,
    glow: 0,
    text: "#ffe9d6",
    icon: 0xffe9d6
  },

  muted: {
    fill: 0x15182b,
    fillHover: 0x1a1e34,
    stroke: 0x32375a,
    strokeHover: 0x424973,
    glow: 0,
    text: "#9aa0c4",
    icon: 0x9aa0c4
  }
};

export class UiButton
  extends Phaser.GameObjects.Container {

  private readonly panel:
    Phaser.GameObjects.Graphics;

  private readonly iconGraphics:
    Phaser.GameObjects.Graphics;

  private readonly labelText:
    Phaser.GameObjects.Text;

  private variant: Variant;

  private hovered = false;

  constructor(
    scene: Phaser.Scene,
    private readonly options: UiButtonOptions
  ) {

    super(scene, options.x, options.y);

    this.variant =
      options.variant ?? "neutral";

    this.panel =
      scene.add.graphics();

    this.iconGraphics =
      scene.add.graphics();

    this.labelText =
      scene.add.text(
        0,
        0,
        options.label,
        {
          fontFamily: FONT_BODY,
          fontSize: `${options.fontSize ?? 18}px`,
          fontStyle: "bold",
          color: COLOR.textBright
        }
      ).setOrigin(0.5);

    this.add([
      this.panel,
      this.iconGraphics,
      this.labelText
    ]);

    this.setSize(
      options.width,
      options.height
    );

    this.setInteractive({
      useHandCursor: true
    });

    this.on(
      "pointerover",
      () => {
        this.hovered = true;
        this.redraw();
      }
    );

    this.on(
      "pointerout",
      () => {
        this.hovered = false;
        this.redraw();
      }
    );

    scene.add.existing(this);

    this.redraw();
  }

  // ========================================
  // LABEL AND LOOK
  // ========================================

  /** The area the button covers on screen (so a test, or
   *  anything else, can find where to click). */
  override getBounds(
    output: Phaser.Geom.Rectangle =
      new Phaser.Geom.Rectangle()
  ): Phaser.Geom.Rectangle {

    return output.setTo(
      this.x - this.displayWidth / 2,
      this.y - this.displayHeight / 2,
      this.displayWidth,
      this.displayHeight
    );
  }

  /** The words on the button. */
  get text(): string {
    return this.labelText.text;
  }

  setText(label: string): this {

    // A button that has been destroyed (its scene moved on)
    // has nothing left to draw on.
    if (!this.active) {
      return this;
    }

    this.labelText.setText(label);

    this.redraw();

    return this;
  }

  setVariant(variant: Variant): this {

    if (!this.active) {
      return this;
    }

    if (variant !== this.variant) {

      this.variant = variant;

      this.redraw();
    }

    return this;
  }

  get currentVariant(): Variant {
    return this.variant;
  }

  /** Only the part that can be clicked. */
  setEnabled(enabled: boolean): this {

    if (enabled) {
      this.setInteractive({ useHandCursor: true });
    } else {
      this.disableInteractive();
    }

    return this;
  }

  // ========================================
  // DRAWING
  // ========================================

  private redraw() {

    if (!this.active) {
      return;
    }

    const {
      width,
      height,
      icon,
      layout = "inline",
      radius = 12
    } = this.options;

    const look = LOOKS[this.variant];

    const hover = this.hovered;

    this.panel.clear();

    drawPanel(
      this.panel,
      0,
      0,
      width,
      height,
      {
        fill:
          hover
            ? look.fillHover
            : look.fill,

        stroke:
          hover
            ? look.strokeHover
            : look.stroke,

        strokeWidth: 2,

        radius,

        glow:
          look.glow
            ? look.glow + (hover ? 4 : 0)
            : 0,

        glowStrength: hover ? 0.9 : 0.6
      }
    );

    this.labelText.setColor(look.text);

    this.iconGraphics.clear();

    const iconSize =
      Math.min(28, height * 0.55);

    if (!icon) {

      this.labelText.setX(0);

      return;
    }

    let iconX: number;

    if (layout === "edge") {

      iconX = -width / 2 + 34;

      this.labelText.setX(14);

    } else {

      // icon + gap + label, centred as a group

      const gap = 12;

      const total =
        iconSize + gap + this.labelText.width;

      iconX = -total / 2 + iconSize / 2;

      this.labelText.setX(
        iconX + iconSize / 2 + gap +
          this.labelText.width / 2
      );
    }

    this.iconGraphics.setPosition(iconX, 0);

    drawIcon(
      this.iconGraphics,
      icon,
      iconSize,
      look.icon
    );

    // the arrow at the right edge

    if (layout === "edge") {

      // (a separate Graphics: each has one position)
      this.drawChevron(look);
    }
  }

  private chevron?: Phaser.GameObjects.Graphics;

  private drawChevron(look: Look) {

    if (!this.chevron) {

      this.chevron =
        this.scene.add.graphics();

      this.add(this.chevron);
    }

    this.chevron.clear();

    this.chevron.setPosition(
      this.options.width / 2 - 32,
      0
    );

    drawIcon(
      this.chevron,
      "chevron",
      16,
      look.icon,
      0.85
    );
  }
}
