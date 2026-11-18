import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";

import { audio } from "../audio/AudioManager";

import { NetworkManager } from "../network/NetworkManager";

import { tabSession } from "../net/session";

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

  // Why we are back at the menu (shown once).
  private notice = "";

  constructor() {
    super("MenuScene");
  }

  init(
    data: {
      notice?: string;
    }
  ) {

    this.notice =
      data?.notice ?? "";
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

    // ----------------------------------------
    // WHY WE ARE HERE / RESUME
    // ----------------------------------------

    if (this.notice) {

      const notice =
        this.showStatus(
          this.notice,
          "#ff9999"
        );

      this.time.delayedCall(
        4500,
        () => notice.destroy()
      );

    } else {

      void this.tryResume();
    }
  }

  // ========================================
  // NOTICE + RESUME
  // ========================================

  private showStatus(
    message: string,
    color: string
  ) {

    const text =
      this.add.text(
        400,
        480,
        message,
        {
          fontSize: "20px",
          color,
          align: "center"
        }
      ).setOrigin(0.5);

    return text;
  }

  // After a page reload the connection library
  // knows nothing, but the tab remembers the
  // room it was in. The server keeps a dropped
  // player's seat for a while: take it back.

  private async tryResume() {

    const saved =
      tabSession.load();

    if (!saved) {
      return;
    }

    const status =
      this.showStatus(
        "Rejoining your game...",
        "#ffcc66"
      );

    let room: Room | undefined;

    try {

      const network =
        new NetworkManager();

      const joined =
        await network.resumeRoom(
          saved.token
        );

      room = joined;

      // The server describes the room as soon
      // as we are back in.

      const resync =
        await new Promise<any>(
          (resolve, reject) => {

            const off =
              joined.onMessage(
                "resync",
                (data: any) => {

                  off();

                  resolve(data);
                }
              );

            joined.send(
              "requestResync"
            );

            setTimeout(
              () =>
                reject(
                  new Error(
                    "no answer from the room"
                  )
                ),
              5000
            );
          }
        );

      // The player may have clicked something
      // else while we were connecting.

      if (
        !this.scene.isActive(
          "MenuScene"
        )
      ) {

        joined.leave().catch(() => {});

        return;
      }

      if (resync.gameStarted) {

        this.scene.start(
          "GameScene",
          {
            room: joined,

            players:
              resync.players,

            myPlayer:
              resync.players.find(
                (player: any) =>
                  player.id ===
                  joined.sessionId
              )
          }
        );

      } else {

        this.scene.start(
          "LobbyScene",
          {
            mode: "resume",

            room: joined,

            resync
          }
        );
      }

    } catch (error) {

      console.warn(
        "Could not resume:",
        error
      );

      tabSession.forget();

      room?.leave().catch(() => {});

      if (
        this.scene.isActive(
          "MenuScene"
        )
      ) {

        status.setText(
          "Could not rejoin your game."
        );

        status.setColor(
          "#ff9999"
        );

        this.time.delayedCall(
          3500,
          () => status.destroy()
        );
      }
    }
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