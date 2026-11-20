import Phaser from "phaser";

// ==========================================
// ICONS
// ==========================================
//
// Small pictures drawn with lines and shapes, so the game
// needs no image files. Each one is drawn centred on (0, 0)
// into a Graphics object, inside a square of `size` pixels.

export type IconName =
  | "plus"
  | "people"
  | "play"
  | "exit"
  | "copy"
  | "person"
  | "star"
  | "speaker"
  | "pencil"
  | "chevron";

type G = Phaser.GameObjects.Graphics;

const poly = (
  g: G,
  points: [number, number][],
  fill: boolean
) => {

  const list =
    points.map(
      ([x, y]) =>
        new Phaser.Math.Vector2(x, y)
    );

  if (fill) {
    g.fillPoints(list, true, true);
  } else {
    g.strokePoints(list, false, false);
  }
};

export function drawIcon(
  g: G,
  name: IconName,
  size: number,
  color: number,
  alpha = 1
) {

  const s = size / 2;

  const line = Math.max(2, size / 9);

  g.lineStyle(line, color, alpha);
  g.fillStyle(color, alpha);

  switch (name) {

    // a square with a plus in it
    case "plus": {

      g.strokeRoundedRect(-s, -s, size, size, size * 0.22);

      g.lineBetween(-s * 0.5, 0, s * 0.5, 0);
      g.lineBetween(0, -s * 0.5, 0, s * 0.5);

      break;
    }

    // three people: heads with rounded shoulders
    case "people": {

      const shoulders = (
        cx: number,
        base: number,
        radius: number
      ) => {

        g.beginPath();

        g.slice(
          cx,
          base,
          radius,
          Math.PI,
          Math.PI * 2,
          false
        );

        g.fillPath();
      };

      // the two at the sides, a little dimmer and smaller
      g.fillStyle(color, alpha * 0.7);

      g.fillCircle(-s * 0.82, -s * 0.18, s * 0.27);

      shoulders(-s * 0.82, s * 0.95, s * 0.5);

      g.fillCircle(s * 0.82, -s * 0.18, s * 0.27);

      shoulders(s * 0.82, s * 0.95, s * 0.5);

      // the one in front
      g.fillStyle(color, alpha);

      g.fillCircle(0, -s * 0.42, s * 0.36);

      shoulders(0, s * 0.95, s * 0.68);

      break;
    }

    // a triangle pointing right
    case "play": {

      g.fillTriangle(
        -s * 0.55, -s * 0.8,
        -s * 0.55, s * 0.8,
        s * 0.85, 0
      );

      break;
    }

    // a doorway with an arrow leaving it
    case "exit": {

      poly(
        g,
        [
          [-s * 0.15, -s * 0.85],
          [-s * 0.85, -s * 0.85],
          [-s * 0.85, s * 0.85],
          [-s * 0.15, s * 0.85]
        ],
        false
      );

      g.lineBetween(-s * 0.2, 0, s * 0.85, 0);

      poly(
        g,
        [
          [s * 0.35, -s * 0.45],
          [s * 0.85, 0],
          [s * 0.35, s * 0.45]
        ],
        false
      );

      break;
    }

    // a sheet of paper with a folded corner
    case "copy": {

      poly(
        g,
        [
          [-s * 0.55, -s * 0.9],
          [s * 0.2, -s * 0.9],
          [s * 0.65, -s * 0.45],
          [s * 0.65, s * 0.9],
          [-s * 0.55, s * 0.9],
          [-s * 0.55, -s * 0.9]
        ],
        false
      );

      poly(
        g,
        [
          [s * 0.2, -s * 0.9],
          [s * 0.2, -s * 0.45],
          [s * 0.65, -s * 0.45]
        ],
        false
      );

      break;
    }

    // head and shoulders
    case "person": {

      g.fillCircle(0, -s * 0.38, s * 0.42);

      g.fillEllipse(0, s * 0.72, s * 1.5, s * 1.0);

      break;
    }

    // a five-pointed star
    case "star": {

      const points: [number, number][] = [];

      for (let i = 0; i < 10; i++) {

        const angle =
          -Math.PI / 2 + (i * Math.PI) / 5;

        const radius =
          i % 2 === 0
            ? s
            : s * 0.42;

        points.push([
          Math.cos(angle) * radius,
          Math.sin(angle) * radius
        ]);
      }

      poly(g, points, true);

      break;
    }

    // a loudspeaker with a sound wave
    case "speaker": {

      poly(
        g,
        [
          [-s * 0.9, -s * 0.35],
          [-s * 0.4, -s * 0.35],
          [s * 0.1, -s * 0.8],
          [s * 0.1, s * 0.8],
          [-s * 0.4, s * 0.35],
          [-s * 0.9, s * 0.35]
        ],
        true
      );

      g.beginPath();

      g.arc(s * 0.1, 0, s * 0.55, -0.9, 0.9, false);

      g.strokePath();

      g.beginPath();

      g.arc(s * 0.1, 0, s * 0.95, -0.9, 0.9, false);

      g.strokePath();

      break;
    }

    // a pencil, writing end bottom left
    case "pencil": {

      g.lineBetween(-s * 0.55, s * 0.55, s * 0.6, -s * 0.6);

      g.lineStyle(line * 1.6, color, alpha);

      g.lineBetween(-s * 0.3, s * 0.3, s * 0.45, -s * 0.45);

      g.lineStyle(line, color, alpha);

      g.fillTriangle(
        -s * 0.95, s * 0.95,
        -s * 0.75, s * 0.4,
        -s * 0.4, s * 0.75
      );

      break;
    }

    // ">"
    case "chevron": {

      poly(
        g,
        [
          [-s * 0.4, -s * 0.8],
          [s * 0.4, 0],
          [-s * 0.4, s * 0.8]
        ],
        false
      );

      break;
    }
  }
}

/**
 * Three bars of rising height, filled from the left:
 * 3 = a good connection, 1 = a poor one.
 */
export function drawSignal(
  g: G,
  size: number,
  bars: 0 | 1 | 2 | 3,
  color: number,
  offColor = 0x3a3f5c
) {

  const w = size * 0.26;

  const gap = size * 0.12;

  for (let i = 0; i < 3; i++) {

    const height = size * (0.4 + i * 0.3);

    g.fillStyle(
      i < bars ? color : offColor,
      1
    );

    g.fillRect(
      -size * 0.5 + i * (w + gap),
      size * 0.5 - height,
      w,
      height
    );
  }
}
