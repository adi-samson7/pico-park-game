/// <reference types="vite/client" />
import Phaser from "phaser";
import "./style.css";

// The fonts are part of the game (no downloads from the
// internet): a pixel font for the title, a monospace for the rest.
import "@fontsource/press-start-2p/latin-400.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";

import { MenuScene } from "./scenes/MenuScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";
import { audio } from "./audio/AudioManager";
import { controls } from "./input/Controls";
import { FONT_BODY } from "./ui/theme";

// Every piece of text uses the monospace unless it asks for
// something else (the title does).
{
  const factory =
    Phaser.GameObjects.GameObjectFactory.prototype;

  const original = factory.text;

  factory.text = function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle
  ) {

    return original.call(
      this,
      x,
      y,
      text,
      {
        fontFamily: FONT_BODY,
        ...style
      }
    );
  } as typeof factory.text;
}

// Canvas text is drawn with whatever font is ready at that
// moment: wait for ours (but never for long).
async function fontsReady() {

  try {

    await Promise.race([
      Promise.all([
        document.fonts.load('34px "Press Start 2P"'),
        document.fonts.load('16px "JetBrains Mono"'),
        document.fonts.load('bold 16px "JetBrains Mono"')
      ]),
      new Promise(
        resolve =>
          setTimeout(resolve, 2500)
      )
    ]);

  } catch {
    // fall back to the system monospace
  }
}

const config:
  Phaser.Types.Core.GameConfig = {

  type: Phaser.AUTO,

  width: 800,

  height: 600,

  backgroundColor: "#202020",

  // The game is drawn at 800 x 600 and shown at 90% of
  // that (720 x 540 on screen). Mouse clicks and the name
  // box follow the canvas's real size, so they stay
  // aligned.
  scale: {

    mode: Phaser.Scale.NONE,

    zoom: 0.9
  },

  physics: {

    default: "arcade",

    arcade: {

      gravity: {
        x: 0,
        y: 1000
      },

      debug: false
    }
  },

  scene: [
    MenuScene,
    LobbyScene,
    GameScene
  ]
};

await fontsReady();

// The keyboard, read by physical key (see input/Controls.ts).
controls.attach(window);

const game =
  new Phaser.Game(
    config
  );

// Debug hooks for automated browser tests:
// always in the dev server, and in a
// production build only when the page is
// opened with ?debug.

if (
  import.meta.env.DEV ||
  new URLSearchParams(
    window.location.search
  ).has("debug")
) {

  Object.assign(
    window,
    {
      __pico: game,
      __audio: audio,
      __controls: controls
    }
  );
}