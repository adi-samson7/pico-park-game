import Phaser from "phaser";

import { audio } from "../audio/AudioManager";

import {
  addMuteButton,
  ensurePlayerTexture,
  juiceButton
} from "../effects";

// Two mascots each side, clear of the buttons.
const MASCOT_X = [
  120,
  200,
  600,
  680
];

const PLAYER_COLORS = [
  0xff4444,
  0x4488ff,
  0x44cc66,
  0xffcc33
];

export class MenuScene extends Phaser.Scene {

  constructor() {
    super("MenuScene");
  }

  create() {

    // ----------------------------------------
    // BACKGROUND
    // ----------------------------------------

    this.cameras.main.setBackgroundColor(
      "#202020"
    );

    this.createBackdrop();

    this.createMascots();

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

    const title =
      this.add.text(
        400,
        150,
        "PICO CO-OP",
        {
          fontSize: "48px",
          color: "#ffffff",
          fontStyle: "bold"
        }
      ).setOrigin(0.5);

    // Title drops in, then bobs gently.

    title.setAlpha(0);

    title.y = 100;

    this.tweens.add({

      targets: title,

      y: 150,

      alpha: 1,

      duration: 600,

      ease: "Bounce.easeOut",

      onComplete: () => {

        this.tweens.add({

          targets: title,

          y: 144,

          scale: 1.03,

          duration: 1400,

          yoyo: true,

          repeat: -1,

          ease: "Sine.easeInOut"
        });
      }
    });

    // ----------------------------------------
    // CREATE ROOM BUTTON
    // ----------------------------------------

    const createButton =
      this.add.text(
        400,
        280,
        "CREATE ROOM",
        {
          fontSize: "28px",
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 30,
            right: 30,
            top: 15,
            bottom: 15
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

    juiceButton(
      this,
      createButton
    );

    createButton.setAlpha(0);

    this.tweens.add({

      targets: createButton,

      alpha: 1,

      duration: 400,

      delay: 250
    });

    createButton.on(
      "pointerover",
      () => {
        createButton.setStyle({
          backgroundColor: "#666666"
        });
      }
    );

    createButton.on(
      "pointerout",
      () => {
        createButton.setStyle({
          backgroundColor: "#444444"
        });
      }
    );

    createButton.on(
      "pointerdown",
      () => {

        console.log(
          "Create room clicked"
        );

        this.scene.start(
          "LobbyScene",
          {
            mode: "create"
          }
        );
      }
    );

    // ----------------------------------------
    // JOIN ROOM BUTTON
    // ----------------------------------------

    const joinButton =
      this.add.text(
        400,
        380,
        "JOIN ROOM",
        {
          fontSize: "28px",
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 40,
            right: 40,
            top: 15,
            bottom: 15
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

    juiceButton(
      this,
      joinButton
    );

    joinButton.setAlpha(0);

    this.tweens.add({

      targets: joinButton,

      alpha: 1,

      duration: 400,

      delay: 400
    });

    joinButton.on(
      "pointerover",
      () => {
        joinButton.setStyle({
          backgroundColor: "#666666"
        });
      }
    );

    joinButton.on(
      "pointerout",
      () => {
        joinButton.setStyle({
          backgroundColor: "#444444"
        });
      }
    );

    joinButton.on(
      "pointerdown",
      () => {

        console.log(
          "Join room clicked"
        );

        this.scene.start(
          "LobbyScene",
          {
            mode: "join"
          }
        );
      }
    );
  }

  // ========================================
  // BACKDROP
  // ========================================

  // Translucent blocks drifting upwards.

  private createBackdrop() {

    for (let i = 0; i < 16; i++) {

      const size =
        10 + Math.random() * 18;

      const block =
        this.add.rectangle(
          Math.random() * 800,
          Math.random() * 640,
          size,
          size,
          PLAYER_COLORS[i % 4],
          0.16
        );

      block.setDepth(-5);

      this.tweens.add({

        targets: block,

        y: -40,

        duration:
          9000 + Math.random() * 9000,

        repeat: -1,

        onRepeat: () => {

          block.x =
            Math.random() * 800;

          block.y = 640;
        }
      });

      this.tweens.add({

        targets: block,

        angle: 360,

        duration:
          6000 + Math.random() * 6000,

        repeat: -1
      });
    }
  }

  // ========================================
  // MASCOTS
  // ========================================

  // The four players, hopping on the spot.

  private createMascots() {

    this.add.rectangle(
      400,
      510,
      800,
      80,
      0x2a2a2a
    );

    PLAYER_COLORS.forEach(
      (color, i) => {

        const baseY = 480;

        const mascot =
          this.add.image(
            MASCOT_X[i],
            baseY,
            ensurePlayerTexture(
              this,
              color
            )
          ).setOrigin(
            0.5,
            1
          );

        const hop = () => {

          // Crouch, leap, land.

          this.tweens.add({

            targets: mascot,

            scaleX: 1.15,

            scaleY: 0.8,

            duration: 90,

            yoyo: true,

            onComplete: () => {

              this.tweens.add({

                targets: mascot,

                y: baseY - 55,

                scaleX: 0.85,

                scaleY: 1.2,

                duration: 260,

                ease: "Sine.easeOut",

                yoyo: true,

                onComplete: () => {

                  this.tweens.add({

                    targets: mascot,

                    scaleX: 1.2,

                    scaleY: 0.8,

                    duration: 80,

                    yoyo: true
                  });
                }
              });
            }
          });
        };

        this.time.addEvent({

          delay: 2000,

          startAt: -i * 450,

          loop: true,

          callback: hop
        });
      }
    );
  }
}