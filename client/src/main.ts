import Phaser from "phaser";
import "./style.css";

import { MenuScene } from "./scenes/MenuScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";

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

new Phaser.Game(
  config
);