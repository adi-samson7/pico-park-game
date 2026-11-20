import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";

import { audio } from "../audio/AudioManager";

import { NetworkManager } from "../network/NetworkManager";

import { tabSession } from "../net/session";

import {
  loadProfile,
  saveProfile
} from "../profile";

import {
  NAME_MAX,
  PALETTE,
  sanitizeName
} from "../shared/profile";

import {
  addMuteButton,
  ensurePlayerTexture,
  juiceButton
} from "../effects";

import {
  addBackground,
  addTitle,
  drawPanel
} from "../ui/draw";

import { drawIcon } from "../ui/icons";

import { OverlayInput } from "../ui/OverlayInput";

import {
  COLOR,
  FONT_BODY
} from "../ui/theme";

import { UiButton } from "../ui/UiButton";

// ==========================================
// THE MENU
// ==========================================
//
// Title, CREATE ROOM / JOIN ROOM, and the player's name and
// colour. The four mascots hop on the floor below.

// The four players hopping on the floor.
const MASCOT_X = [
  97,
  179,
  623,
  703
];

const MASCOT_COLORS = [
  0xff4444,
  0x4488ff,
  0x44cc66,
  0xffcc33
];

// The floor starts here; the mascots stand on it.
const FLOOR_TOP = 431;

const MASCOT_BASE = 443;

export class MenuScene extends Phaser.Scene {

  // Why we are back at the menu (shown once).
  private notice = "";

  // The text box for the player's name (a real <input> over
  // the canvas).
  private nameInput: OverlayInput | null = null;

  // Public so the browser tests can find and click them.
  createButton!: UiButton;

  joinButton!: UiButton;

  swatches: Phaser.GameObjects.Arc[] = [];

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

    this.nameInput = null;

    this.swatches = [];
  }

  create() {

    // ----------------------------------------
    // BACKGROUND, FLOOR, MASCOTS
    // ----------------------------------------

    addBackground(this);

    this.createFloor();

    this.createMascots();

    addMuteButton(
      this,
      20,
      565
    );

    audio.playMusic(
      "menu"
    );

    // ----------------------------------------
    // TITLE
    // ----------------------------------------

    const title =
      addTitle(
        this,
        123,
        34
      );

    // The title drops in.

    title.setAlpha(0);

    title.y = 93;

    this.tweens.add({

      targets: title,

      y: 123,

      alpha: 1,

      duration: 600,

      ease: "Bounce.easeOut"
    });

    // ----------------------------------------
    // CREATE ROOM / JOIN ROOM
    // ----------------------------------------

    this.createButton =
      new UiButton(
        this,
        {
          x: 400,
          y: 248,
          width: 316,
          height: 54,
          label: "CREATE ROOM",
          fontSize: 21,
          icon: "plus",
          layout: "edge",
          variant: "accent"
        }
      );

    this.joinButton =
      new UiButton(
        this,
        {
          x: 400,
          y: 320,
          width: 316,
          height: 54,
          label: "JOIN ROOM",
          fontSize: 21,
          icon: "people",
          layout: "edge",
          variant: "neutral"
        }
      );

    for (
      const [button, delay]
      of [
        [this.createButton, 250],
        [this.joinButton, 400]
      ] as const
    ) {

      juiceButton(
        this,
        button
      );

      button.setAlpha(0);

      this.tweens.add({

        targets: button,

        alpha: 1,

        duration: 400,

        delay
      });
    }

    this.createButton.on(
      "pointerdown",
      () => {

        this.scene.start(
          "LobbyScene",
          {
            mode: "create"
          }
        );
      }
    );

    this.joinButton.on(
      "pointerdown",
      () => {

        this.scene.start(
          "LobbyScene",
          {
            mode: "join"
          }
        );
      }
    );

    // ----------------------------------------
    // NAME AND COLOUR
    // ----------------------------------------

    this.createProfileEditor();

    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => {

        this.nameInput?.destroy();

        this.nameInput = null;
      }
    );

    // ----------------------------------------
    // WHY WE ARE HERE / RESUME
    // ----------------------------------------

    if (this.notice) {

      const notice =
        this.showStatus(
          this.notice,
          COLOR.red_
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
  // NAME AND COLOUR
  // ========================================
  //
  // Remembered between visits and sent when creating or
  // joining a room. Leaving the name empty gives "Player N",
  // not choosing a colour gives the colour of your seat.

  private createProfileEditor() {

    const profile =
      loadProfile();

    // ---- the heading, with a line on each side ----

    const heading =
      this.add.text(
        400,
        421,
        "YOUR NAME AND COLOUR",
        {
          fontSize: "13px",
          color: COLOR.textDim
        }
      ).setOrigin(0.5);

    const lines =
      this.add.graphics();

    lines.fillStyle(COLOR.stroke, 0.9);

    lines.fillRect(
      400 - heading.width / 2 - 70,
      420,
      58,
      1
    );

    lines.fillRect(
      400 + heading.width / 2 + 12,
      420,
      58,
      1
    );

    // ---- the name box ----

    const boxX = 400;

    const boxY = 453;

    const boxWidth = 250;

    const boxHeight = 36;

    const panel =
      this.add.graphics();

    drawPanel(
      panel,
      boxX,
      boxY,
      boxWidth,
      boxHeight,
      {
        fill: COLOR.panelDeep,
        radius: 10
      }
    );

    // the pencil, on the right inside the box
    const pencil =
      this.add.graphics()
        .setPosition(
          boxX + boxWidth / 2 - 22,
          boxY
        );

    drawIcon(
      pencil,
      "pencil",
      14,
      0x9aa0c4
    );

    this.nameInput =
      new OverlayInput(
        this.game.canvas,
        {
          x: boxX,
          y: boxY,
          width: boxWidth,
          height: boxHeight,
          value: profile.name,
          placeholder: "Your name",
          maxLength: NAME_MAX,
          transparent: true,

          onInput: (value) => {

            profile.name =
              sanitizeName(value);

            saveProfile(profile);
          },

          // Show what will really be used.
          onCommit: (value) => {

            profile.name =
              sanitizeName(value);

            saveProfile(profile);

            return profile.name;
          }
        }
      );

    // ---- the colours ----

    this.swatches = [];

    const glows:
      Phaser.GameObjects.Arc[] = [];

    const refresh = () => {

      this.swatches.forEach(
        (swatch, i) => {

          const chosen =
            profile.color === PALETTE[i];

          swatch.setStrokeStyle(
            chosen ? 3 : 0,
            0xffffff
          );

          swatch.setScale(
            chosen ? 1.2 : 1
          );

          glows[i].setVisible(chosen);
        }
      );
    };

    PALETTE.forEach(
      (color, i) => {

        const x =
          400 + (i - 3.5) * 36.4;

        // a soft halo, shown behind the chosen one
        const glow =
          this.add.circle(
            x,
            500,
            19,
            color,
            0.28
          ).setVisible(false);

        glows.push(glow);

        const swatch =
          this.add.circle(
            x,
            500,
            11.5,
            color
          )
            .setInteractive({
              useHandCursor: true
            });

        swatch.setData(
          "color",
          color
        );

        swatch.on(
          "pointerdown",
          () => {

            // Clicking the chosen colour again lets the game
            // choose (the colour of your seat).
            profile.color =
              profile.color === color
                ? null
                : color;

            saveProfile(profile);

            audio.sfx("click");

            refresh();
          }
        );

        this.swatches.push(swatch);
      }
    );

    refresh();
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
        186,
        message,
        {
          fontFamily: FONT_BODY,
          fontSize: "17px",
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
        COLOR.amber_
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

            room,

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
          COLOR.red_
        );

        this.time.delayedCall(
          3500,
          () => status.destroy()
        );
      }
    }
  }

  // ========================================
  // FLOOR
  // ========================================

  private createFloor() {

    const g =
      this.add.graphics();

    g.fillStyle(COLOR.floor, 1);

    g.fillRect(
      0,
      FLOOR_TOP,
      800,
      600 - FLOOR_TOP
    );

    // a lighter edge on top, and a pixel-style step at each end
    g.fillStyle(COLOR.floorEdge, 1);

    g.fillRect(0, FLOOR_TOP, 800, 3);

    g.fillRect(0, FLOOR_TOP - 6, 90, 6);

    g.fillRect(710, FLOOR_TOP - 6, 90, 6);

    g.setDepth(-50);
  }

  // ========================================
  // MASCOTS
  // ========================================

  // The four players, hopping on the spot.

  private createMascots() {

    MASCOT_COLORS.forEach(
      (color, i) => {

        const baseY = MASCOT_BASE;

        // a shadow on the floor
        this.add.ellipse(
          MASCOT_X[i],
          baseY + 3,
          52,
          10,
          0x000000,
          0.35
        ).setDepth(-40);

        const mascot =
          this.add.image(
            MASCOT_X[i],
            baseY,
            ensurePlayerTexture(
              this,
              color
            )
          )
            .setOrigin(0.5, 1)
            .setDepth(-30);

        // little sparks on the outer two, as in the artwork
        if (i === 0 || i === 3) {

          const g = this.add.graphics().setDepth(-30);

          const side = i === 0 ? -1 : 1;

          g.lineStyle(
            3,
            i === 0
              ? 0xff6b6b
              : 0x9be54a,
            1
          );

          const cx =
            MASCOT_X[i] + side * 34;

          const cy =
            baseY - 82;

          g.lineBetween(
            cx - side * 4,
            cy + 6,
            cx + side * 6,
            cy - 6
          );

          g.lineBetween(
            cx + side * 5,
            cy + 8,
            cx + side * 14,
            cy
          );
        }

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
