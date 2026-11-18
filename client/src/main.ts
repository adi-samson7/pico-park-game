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

// Debug hooks for automated browser tests
// (dev server only, never in a build).

if (import.meta.env.DEV) {

  Object.assign(
    window,
    {
      __pico: game,
      __audio: audio
    }
  );
}