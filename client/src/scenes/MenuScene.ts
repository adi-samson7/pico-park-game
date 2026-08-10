import Phaser from "phaser";

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

    // ----------------------------------------
    // TITLE
    // ----------------------------------------

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
}