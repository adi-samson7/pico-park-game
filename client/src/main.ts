/// <reference types="vite/client" />
import Phaser from "phaser";
import "./style.css";

import { MenuScene } from "./scenes/MenuScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";
import { audio } from "./audio/AudioManager";

const config:
  Phaser.Types.Core.GameConfig = {

  type: Phaser.AUTO,

  width: 800,

  height: 600,

  backgroundColor: "#202020",

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
      __audio: audio
    }
  );
}