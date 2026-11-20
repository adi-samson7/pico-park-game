import Phaser from "phaser";

import {
  COLOR,
  FONT_BODY,
  FONT_TITLE
} from "./theme";

// ==========================================
// SHARED DRAWING FOR THE MENU AND LOBBY
// ==========================================

const BACKGROUND_KEY = "ui-background";

/**
 * The dark backdrop: a navy gradient with a faint grid of
 * squares, some larger faded blocks and a few coloured
 * specks. Drawn once into a texture, then reused.
 */
export function addBackground(
  scene: Phaser.Scene
): Phaser.GameObjects.Image {

  if (!scene.textures.exists(BACKGROUND_KEY)) {

    const canvas =
      scene.textures.createCanvas(
        BACKGROUND_KEY,
        800,
        600
      );

    if (canvas) {

      const ctx = canvas.getContext();

      const gradient =
        ctx.createLinearGradient(0, 0, 0, 600);

      gradient.addColorStop(0, "#070914");
      gradient.addColorStop(1, "#151832");

      ctx.fillStyle = gradient;

      ctx.fillRect(0, 0, 800, 600);

      // a faint checkerboard
      ctx.fillStyle = "rgba(120, 130, 220, 0.035)";

      for (let y = 0; y < 600; y += 24) {

        for (let x = 0; x < 800; x += 24) {

          if (((x + y) / 24) % 2 === 0) {
            ctx.fillRect(x, y, 24, 24);
          }
        }
      }

      // bigger faded blocks and a few bright specks, always
      // the same ones (a seeded sequence, not Math.random)
      let seed = 11;

      const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };

      for (let i = 0; i < 38; i++) {

        const size = 18 + Math.floor(random() * 3) * 12;

        ctx.fillStyle =
          `rgba(60, 70, 140, ${0.06 + random() * 0.1})`;

        ctx.fillRect(
          Math.floor(random() * 33) * 24,
          Math.floor(random() * 25) * 24,
          size,
          size
        );
      }

      const specks = [
        "rgba(120, 90, 255, 0.55)",
        "rgba(60, 110, 255, 0.5)",
        "rgba(255, 190, 60, 0.45)",
        "rgba(60, 200, 120, 0.4)",
        "rgba(255, 90, 90, 0.35)"
      ];

      for (let i = 0; i < 14; i++) {

        ctx.fillStyle = specks[i % specks.length];

        const size = 8 + Math.floor(random() * 3) * 4;

        ctx.fillRect(
          Math.floor(random() * 780),
          Math.floor(random() * 580),
          size,
          size
        );
      }

      canvas.refresh();
    }
  }

  return scene.add
    .image(400, 300, BACKGROUND_KEY)
    .setDepth(-100);
}

/**
 * A rounded rectangle with an optional soft glow around
 * it. (x, y) is its CENTRE.
 */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    fill: number;
    fillAlpha?: number;
    stroke?: number;
    strokeAlpha?: number;
    strokeWidth?: number;
    radius?: number;
    glow?: number;
    glowStrength?: number;
  }
) {

  const radius =
    options.radius ?? 10;

  const left = x - width / 2;

  const top = y - height / 2;

  // glow: wider and fainter strokes behind
  if (options.glow && options.stroke !== undefined) {

    const layers = 5;

    for (let i = layers; i >= 1; i--) {

      g.lineStyle(
        (options.strokeWidth ?? 2) + i * (options.glow / layers) * 2,
        options.stroke,
        ((options.glowStrength ?? 0.5) / layers) * (layers - i + 1) * 0.55
      );

      g.strokeRoundedRect(
        left,
        top,
        width,
        height,
        radius + i
      );
    }
  }

  g.fillStyle(
    options.fill,
    options.fillAlpha ?? 1
  );

  g.fillRoundedRect(
    left,
    top,
    width,
    height,
    radius
  );

  if (options.stroke !== undefined) {

    g.lineStyle(
      options.strokeWidth ?? 2,
      options.stroke,
      options.strokeAlpha ?? 1
    );

    g.strokeRoundedRect(
      left,
      top,
      width,
      height,
      radius
    );
  }
}

/**
 * "PICO CO-OP" in the pixel font with a soft glow and two
 * blue sparks on each side.
 */
export function addTitle(
  scene: Phaser.Scene,
  y: number,
  size = 34
): Phaser.GameObjects.Text {

  const title =
    scene.add.text(
      400,
      y,
      "PICO CO-OP",
      {
        fontFamily: FONT_TITLE,
        fontSize: `${size}px`,
        color: "#ffffff"
      }
    ).setOrigin(0.5);

  title.setShadow(
    0,
    0,
    "#7da0ff",
    14,
    true,
    true
  );

  const g = scene.add.graphics();

  const half = title.width / 2;

  const spark = (side: -1 | 1) => {

    const cx = 400 + side * (half + 26);

    g.fillStyle(COLOR.blue, 1);

    // two short bars, tilted towards the title
    for (const [dy, tilt] of [[-9, 0.55], [8, -0.4]] as const) {

      g.save();

      g.translateCanvas(cx, y + dy);

      g.rotateCanvas(side * tilt);

      g.fillRect(-9, -2.5, 18, 5);

      g.restore();
    }
  };

  spark(-1);
  spark(1);

  g.setDepth(title.depth);

  return title;
}

/**
 * A pill-shaped label ("LOBBY") with a line running off to
 * each side.
 */
export function addPillHeading(
  scene: Phaser.Scene,
  y: number,
  label: string
) {

  const text =
    scene.add.text(
      400,
      y,
      label.split("").join(" "),
      {
        fontFamily: FONT_BODY,
        fontSize: "17px",
        fontStyle: "bold",
        color: "#c3c8ec"
      }
    ).setOrigin(0.5);

  const g = scene.add.graphics();

  const width = text.width + 52;

  drawPanel(
    g,
    400,
    y,
    width,
    32,
    {
      fill: COLOR.panelRaised,
      stroke: COLOR.stroke,
      strokeWidth: 1,
      radius: 16
    }
  );

  // lines fading out from the pill
  const left = 400 - width / 2;

  for (let i = 0; i < 24; i++) {

    const alpha = 0.9 * (1 - i / 24);

    g.fillStyle(COLOR.blue, alpha);

    g.fillRect(left - 8 - i * 6 - 6, y - 1, 6, 2);

    g.fillRect(400 + width / 2 + 8 + i * 6, y - 1, 6, 2);
  }

  g.setDepth(text.depth - 1);

  return text;
}
