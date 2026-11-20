// ==========================================
// A TEXT BOX OVER THE GAME
// ==========================================
//
// Phaser has no text input of its own. This puts a real
// <input> on top of the canvas at a place given in GAME
// coordinates (800 x 600), and keeps it there when the
// window is resized.
//
// Typing must not reach the game: it listens to the
// keyboard (M mutes, arrows move), so the box stops the
// key events before they get there.

export interface OverlayInputOptions {

  // Centre and size, in game coordinates.
  x: number;
  y: number;
  width: number;
  height: number;

  value?: string;

  placeholder?: string;

  maxLength?: number;

  // No background of its own: the game draws the panel
  // underneath (the box then only adds its edge and text).
  transparent?: boolean;

  // Called on every change with the raw text.
  onInput?: (value: string) => void;

  // Called when the box loses focus, or Enter is pressed.
  // May return a cleaned-up text to put in the box.
  onCommit?: (value: string) => string | void;
}

const GAME_WIDTH = 800;

export class OverlayInput {

  readonly element: HTMLInputElement;

  private observer: ResizeObserver | null = null;

  private readonly reposition = () => this.place();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: OverlayInputOptions
  ) {

    const input = document.createElement("input");

    input.type = "text";

    input.value = options.value ?? "";

    input.placeholder = options.placeholder ?? "";

    input.maxLength = options.maxLength ?? 12;

    input.autocomplete = "off";

    input.spellcheck = false;

    input.setAttribute("aria-label", options.placeholder ?? "text");

    Object.assign(input.style, {
      position: "fixed",
      boxSizing: "border-box",
      zIndex: "10",
      margin: "0",
      padding: "0 8px",
      background:
        options.transparent
          ? "transparent"
          : "#2a2a2a",
      color: "#ffffff",
      border: "2px solid #363b5a",
      borderRadius: "10px",
      outline: "none",
      textAlign: "center",
      fontFamily: '"JetBrains Mono", "Courier New", monospace',
      fontWeight: "bold"
    });

    // Keys typed here are for the box only.
    for (const type of ["keydown", "keyup", "keypress"]) {

      input.addEventListener(
        type,
        (event) => event.stopPropagation()
      );
    }

    input.addEventListener("keydown", (event) => {

      if (event.key === "Enter") {

        this.commit();

        input.blur();
      }
    });

    input.addEventListener("input", () => options.onInput?.(input.value));

    input.addEventListener("focus", () => {
      input.style.borderColor = "#6a95ff";
    });

    input.addEventListener("blur", () => {

      input.style.borderColor = "#363b5a";

      this.commit();
    });

    this.element = input;

    document.body.appendChild(input);

    this.place();

    window.addEventListener("resize", this.reposition);

    if (typeof ResizeObserver !== "undefined") {

      this.observer = new ResizeObserver(this.reposition);

      this.observer.observe(canvas);
    }
  }

  private commit() {

    const cleaned = this.options.onCommit?.(this.element.value);

    if (typeof cleaned === "string") {
      this.element.value = cleaned;
    }
  }

  private place() {

    const rect = this.canvas.getBoundingClientRect();

    // The canvas may be shown smaller than 800 px wide.
    const scale = rect.width / GAME_WIDTH;

    const { x, y, width, height } = this.options;

    Object.assign(this.element.style, {
      left: `${rect.left + (x - width / 2) * scale}px`,
      top: `${rect.top + (y - height / 2) * scale}px`,
      width: `${width * scale}px`,
      height: `${height * scale}px`,
      fontSize: `${Math.max(10, 16 * scale)}px`
    });
  }

  setValue(value: string) {
    this.element.value = value;
  }

  focus() {
    this.element.focus();
  }

  destroy() {

    window.removeEventListener("resize", this.reposition);

    this.observer?.disconnect();

    this.element.remove();
  }
}
