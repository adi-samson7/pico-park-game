import Phaser from "phaser";

import { audio } from "./audio/AudioManager";
import { controls } from "./input/Controls";
import { drawIcon } from "./ui/icons";

// ==========================================
// PARTICLE TEXTURE
// ==========================================

const PARTICLE_KEY = "px";

export function ensureParticleTexture(
  scene: Phaser.Scene
) {

  if (
    scene.textures.exists(
      PARTICLE_KEY
    )
  ) {
    return;
  }

  const graphics =
    scene.add.graphics();

  graphics.fillStyle(
    0xffffff,
    1
  );

  graphics.fillRect(
    0,
    0,
    6,
    6
  );

  graphics.generateTexture(
    PARTICLE_KEY,
    6,
    6
  );

  graphics.destroy();
}

// ==========================================
// BURST
// ==========================================

export interface BurstOptions {

  count?: number;

  color?: number | number[];

  speedMin?: number;

  speedMax?: number;

  // Degrees. Default: all directions.
  angleMin?: number;

  angleMax?: number;

  lifespan?: number;

  gravityY?: number;

  scaleStart?: number;

  depth?: number;
}

/** One-shot puff of particles. */
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: BurstOptions = {}
) {

  ensureParticleTexture(scene);

  const lifespan =
    options.lifespan ?? 500;

  const emitter =
    scene.add.particles(
      x,
      y,
      PARTICLE_KEY,
      {

        emitting:
          false,

        speed: {
          min:
            options.speedMin ?? 60,

          max:
            options.speedMax ?? 180
        },

        angle: {
          min:
            options.angleMin ?? 0,

          max:
            options.angleMax ?? 360
        },

        lifespan,

        gravityY:
          options.gravityY ?? 300,

        scale: {
          start:
            options.scaleStart ?? 1,

          end: 0
        },

        alpha: {
          start: 1,
          end: 0
        },

        tint:
          options.color ??
          0xffffff
      }
    );

  emitter.setDepth(
    options.depth ?? 30
  );

  emitter.explode(
    options.count ?? 12
  );

  scene.time.delayedCall(
    lifespan + 100,
    () => emitter.destroy()
  );
}

// ==========================================
// CONFETTI
// ==========================================

export const CONFETTI_COLORS = [
  0xff4444,
  0x4488ff,
  0x44cc66,
  0xffcc33,
  0xff66cc,
  0x66ddff
];

/** Confetti raining from the top of the
 *  screen for `durationMs`. */
export function confettiRain(
  scene: Phaser.Scene,
  durationMs: number
) {

  ensureParticleTexture(scene);

  const emitter =
    scene.add.particles(
      0,
      0,
      PARTICLE_KEY,
      {

        emitZone: {

          type:
            "random",

          source:
            new Phaser.Geom.Rectangle(
              0,
              -10,
              800,
              10
            ),

          quantity: 1
        } as Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig,

        frequency: 25,

        lifespan: 3500,

        speedY: {
          min: 90,
          max: 240
        },

        speedX: {
          min: -50,
          max: 50
        },

        rotate: {
          start: 0,
          end: 540
        },

        scale: {
          start: 1.3,
          end: 0.8
        },

        alpha: {
          start: 1,
          end: 0.2
        },

        tint:
          CONFETTI_COLORS
      }
    );

  emitter.setDepth(
    90
  );

  scene.time.delayedCall(
    durationMs,
    () => {

      emitter.stop();

      scene.time.delayedCall(
        3600,
        () => emitter.destroy()
      );
    }
  );
}

/** A quick burst of confetti from a point. */
export function confettiBurst(
  scene: Phaser.Scene,
  x: number,
  y: number
) {

  burst(
    scene,
    x,
    y,
    {
      count: 40,
      color: CONFETTI_COLORS,
      speedMin: 120,
      speedMax: 380,
      angleMin: 200,
      angleMax: 340,
      gravityY: 500,
      lifespan: 1100,
      scaleStart: 1.3,
      depth: 80
    }
  );
}

// ==========================================
// FLOATING TEXT
// ==========================================

export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  message: string,
  color = "#ffffff"
) {

  const text =
    scene.add.text(
      x,
      y,
      message,
      {
        fontSize:
          "18px",

        color,

        fontStyle:
          "bold",

        stroke:
          "#000000",

        strokeThickness:
          3
      }
    ).setOrigin(
      0.5
    );

  text.setDepth(
    40
  );

  scene.tweens.add({

    targets:
      text,

    y:
      y - 36,

    alpha:
      0,

    duration:
      700,

    ease:
      "Cubic.easeOut",

    onComplete:
      () => text.destroy()
  });
}

// ==========================================
// MUTE BUTTON
// ==========================================

/**
 * Small "SOUND: ON [M]" label. Click it or
 * press M to mute / unmute.
 */
export function addMuteButton(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Text {

  // Browsers play no sound until the first click or key press:
  // until then "ON" would be a lie, so say what is needed.
  const label = () =>
    audio.isMuted
      ? "SOUND: OFF [M]"
      : audio.running
        ? "SOUND: ON [M]"
        : "SOUND: ON - CLICK ANYWHERE TO START";

  // The speaker icon sits in front of the words.

  const icon =
    scene.add.graphics()
      .setPosition(x + 8, y + 9)
      .setDepth(200);

  const text =
    scene.add.text(
      x + 24,
      y,
      label(),
      {
        fontSize:
          "13px",

        color:
          "#aaaaaa"
      }
    );

  text.setDepth(
    200
  );

  text.setInteractive({
    useHandCursor: true
  });

  const refresh = () => {

    text.setText(
      label()
    );

    text.setColor(
      audio.isMuted
        ? "#ff7b7b"
        : "#9aa0c4"
    );

    icon.clear();

    drawIcon(
      icon,
      "speaker",
      14,
      audio.isMuted
        ? 0xff7b7b
        : 0x9aa0c4
    );
  };

  refresh();

  // The first click unlocks the sound: update the words then.
  const watch =
    scene.time.addEvent({
      delay: 200,
      loop: true,
      callback: refresh
    });

  text.on(
    "pointerdown",
    () => {

      audio.toggleMute();

      audio.sfx(
        "click"
      );
    }
  );

  const unsubscribe =
    audio.onMuteChange(
      refresh
    );

  const onKey = () => {

    audio.toggleMute();

    audio.sfx(
      "click"
    );
  };

  // (from `controls`: Phaser's "keydown-M" goes by keyCode, which
  // is wrong while an input method is on)
  const stopKey =
    controls.onPress(
      "KeyM",
      onKey
    );

  scene.events.once(
    Phaser.Scenes.Events.SHUTDOWN,
    () => {

      unsubscribe();

      watch.remove(false);

      stopKey();
    }
  );

  // Clicking the icon works as well.
  icon.setInteractive(
    new Phaser.Geom.Rectangle(-10, -10, 20, 20),
    Phaser.Geom.Rectangle.Contains
  );

  icon.input!.cursor = "pointer";

  icon.on(
    "pointerdown",
    () => {

      audio.toggleMute();

      audio.sfx(
        "click"
      );
    }
  );

  return text;
}

// ==========================================
// BUTTON JUICE
// ==========================================

/** Hover grow + click sound for any
 *  interactive text button. */
export function juiceButton(
  scene: Phaser.Scene,
  button:
    | Phaser.GameObjects.Text
    | Phaser.GameObjects.Container,
  hoverScale = 1.07
) {

  const to = (
    scale: number
  ) =>
    scene.tweens.add({

      targets:
        button,

      scaleX:
        scale,

      scaleY:
        scale,

      duration:
        90,

      ease:
        "Quad.easeOut"
    });

  button.on(
    "pointerover",
    () => to(hoverScale)
  );

  button.on(
    "pointerout",
    () => to(1)
  );

  button.on(
    "pointerdown",
    () => {

      audio.sfx(
        "click"
      );

      scene.tweens.add({

        targets:
          button,

        scaleX:
          0.94,

        scaleY:
          0.94,

        duration:
          60,

        yoyo:
          true
      });
    }
  );
}

// ==========================================
// PLAYER TEXTURE
// ==========================================

/** Rounded, outlined player body with eyes
 *  looking right (flipX turns it left). */
export function ensurePlayerTexture(
  scene: Phaser.Scene,
  color: number
): string {

  const key =
    `player2_${color}`;

  if (
    scene.textures.exists(
      key
    )
  ) {

    return key;
  }

  const graphics =
    scene.add.graphics();

  const dark =
    Phaser.Display.Color.IntegerToColor(
      color
    ).darken(
      35
    ).color;

  graphics.fillStyle(dark, 1);

  graphics.fillRoundedRect(
    0,
    0,
    40,
    60,
    10
  );

  graphics.fillStyle(color, 1);

  graphics.fillRoundedRect(
    2,
    2,
    36,
    56,
    9
  );

  graphics.fillStyle(
    0xffffff,
    0.22
  );

  graphics.fillRoundedRect(
    5,
    5,
    14,
    20,
    6
  );

  graphics.fillStyle(
    0xffffff,
    1
  );

  graphics.fillCircle(22, 19, 6);

  graphics.fillCircle(33, 19, 6);

  graphics.fillStyle(
    0x111111,
    1
  );

  graphics.fillCircle(24, 19, 3);

  graphics.fillCircle(35, 19, 3);

  graphics.generateTexture(
    key,
    40,
    60
  );

  graphics.destroy();

  return key;
}
