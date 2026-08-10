import Phaser from "phaser";

export class LobbyScene extends Phaser.Scene {

  private mode: "create" | "join" =
    "create";

  constructor() {
    super("LobbyScene");
  }

  init(data: {
    mode: "create" | "join";
  }) {

    this.mode = data.mode;
  }

  create() {

    this.cameras.main.setBackgroundColor(
      "#202020"
    );

    // ----------------------------------------
    // TITLE
    // ----------------------------------------

    this.add.text(
      400,
      100,
      "LOBBY",
      {
        fontSize: "48px",
        color: "#ffffff",
        fontStyle: "bold"
      }
    ).setOrigin(0.5);

    // ----------------------------------------
    // MODE
    // ----------------------------------------

    this.add.text(
      400,
      180,
      this.mode === "create"
        ? "Creating Room..."
        : "Joining Room...",
      {
        fontSize: "24px",
        color: "#cccccc"
      }
    ).setOrigin(0.5);

    // ----------------------------------------
    // TEMPORARY BACK BUTTON
    // ----------------------------------------

    const backButton =
      this.add.text(
        400,
        500,
        "BACK",
        {
          fontSize: "24px",
          color: "#ffffff",
          backgroundColor: "#444444",
          padding: {
            left: 30,
            right: 30,
            top: 10,
            bottom: 10
          }
        }
      )
      .setOrigin(0.5)
      .setInteractive({
        useHandCursor: true
      });

    backButton.on(
      "pointerdown",
      () => {

        this.scene.start(
          "MenuScene"
        );
      }
    );
  }
}