// ==========================================
// CONTROLS
// ==========================================
//
// Reads the keyboard for the game: move with A / D or the
// arrows, jump with W, Space or Up, plus a few single presses
// (Enter, Escape, M).
//
// Why not Phaser's own keys? They go by `event.keyCode`, a
// deprecated number that is NOT reliable for letters:
//
//   - while an input method is active (a Hindi or other
//     non-Latin keyboard, Google Input Tools, an IME) Chrome
//     reports keyCode 229 for every letter, so W, A, S and D
//     stop working while the arrow keys, whose codes never
//     change, keep working
//   - on a non-QWERTY layout the number follows the letter on
//     the key, not its place, so "WASD" lands on the wrong keys
//
// `event.code` names the physical key ("KeyA" is the key where
// A is on a QWERTY keyboard, whatever it prints or whatever
// input method is on) and is what games should use. If a
// browser gives no code, the typed character and finally the
// old number are tried.
//
// No Phaser and no page needed (the event target is passed
// in), so it can be tested.

// (an options object: a bare `true` is not treated the same way
// everywhere)
const CAPTURE = { capture: true };

export type Action =
  | "left"
  | "right"
  | "jump";

const ACTION_CODES: Record<
  Action,
  readonly string[]
> = {

  left: ["KeyA", "ArrowLeft"],

  right: ["KeyD", "ArrowRight"],

  jump: ["Space", "KeyW", "ArrowUp"]
};

const GAME_CODES =
  new Set<string>(
    Object.values(ACTION_CODES).flat()
  );

// Last resort: the old numbers.
const KEY_CODE_TO_CODE:
  Record<number, string> = {

  13: "Enter",
  27: "Escape",
  32: "Space",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  65: "KeyA",
  68: "KeyD",
  77: "KeyM",
  87: "KeyW"
};

interface KeyEventLike {
  code?: string;
  key?: string;
  keyCode?: number;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  preventDefault?: () => void;
}

/**
 * Which physical key an event is about ("KeyA", "Space",
 * "ArrowLeft"...), or "" if it cannot be told.
 */
export function physicalCode(
  event: KeyEventLike
): string {

  const code = event.code;

  if (code && code !== "Unidentified") {
    return code;
  }

  const key =
    typeof event.key === "string"
      ? event.key
      : "";

  if (key === " ") {
    return "Space";
  }

  if (key.length === 1) {

    const upper = key.toUpperCase();

    if (/^[A-Z]$/.test(upper)) {
      return `Key${upper}`;
    }
  }

  switch (key) {

    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
    case "Enter":
    case "Escape":
      return key;

    case "Left":
    case "Right":
    case "Up":
    case "Down":
      return `Arrow${key}`;

    case "Esc":
      return "Escape";
  }

  return (
    KEY_CODE_TO_CODE[
      event.keyCode ?? 0
    ] ?? ""
  );
}

function describe(
  event: KeyEventLike
): string {

  return (
    `${event.code || "-"}  ` +
    `key "${event.key ?? ""}"  ` +
    `keyCode ${event.keyCode ?? 0}`
  );
}

// Typing into a text box is not playing.
function isTyping(
  target: unknown
): boolean {

  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
  } | null;

  if (!element) {
    return false;
  }

  const tag =
    (element.tagName ?? "")
      .toUpperCase();

  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true
  );
}

export class Controls {

  // physical keys of the game that are down
  private held =
    new Set<string>();

  private jumpQueued = false;

  // keys pressed since they were last asked about
  private presses =
    new Set<string>();

  private listeners =
    new Map<string, Set<() => void>>();

  private target: EventTarget | null =
    null;

  // Off while a menu is open: the keys then do not move
  // anyone (single presses like Escape still arrive).
  private gameInput = true;

  /** What the last key press looked like, to find out why
   *  a key does not do what it should. */
  lastKey = "";

  // ========================================
  // ATTACH
  // ========================================

  attach(
    target: EventTarget =
      window
  ) {

    this.detach();

    this.target = target;

    // The capture phase: before anything else sees the key.
    target.addEventListener(
      "keydown",
      this.onKeyDown,
      CAPTURE
    );

    target.addEventListener(
      "keyup",
      this.onKeyUp,
      CAPTURE
    );

    // A key released while the window was not looking would
    // stay "down" for ever.
    target.addEventListener(
      "blur",
      this.reset
    );

    globalThis.document
      ?.addEventListener(
        "visibilitychange",
        this.reset
      );
  }

  detach() {

    if (!this.target) {
      return;
    }

    this.target.removeEventListener(
      "keydown",
      this.onKeyDown,
      CAPTURE
    );

    this.target.removeEventListener(
      "keyup",
      this.onKeyUp,
      CAPTURE
    );

    this.target.removeEventListener(
      "blur",
      this.reset
    );

    globalThis.document
      ?.removeEventListener(
        "visibilitychange",
        this.reset
      );

    this.target = null;

    this.reset();
  }

  // ========================================
  // MOVEMENT
  // ========================================

  get left(): boolean {
    return this.isDown("left");
  }

  get right(): boolean {
    return this.isDown("right");
  }

  private isDown(
    action: Action
  ): boolean {

    return (
      this.gameInput &&
      ACTION_CODES[action].some(
        code =>
          this.held.has(code)
      )
    );
  }

  /** True once per jump key press (not while it is held). */
  consumeJump(): boolean {

    const jump = this.jumpQueued;

    this.jumpQueued = false;

    return jump;
  }

  /** Movement keys work (true) or are ignored (false). */
  setGameInput(
    enabled: boolean
  ) {

    this.gameInput = enabled;

    if (!enabled) {

      this.held.clear();

      this.jumpQueued = false;
    }
  }

  get gameInputEnabled(): boolean {
    return this.gameInput;
  }

  // ========================================
  // SINGLE PRESSES
  // ========================================

  /** True if the key was pressed since the last time this was
   *  asked (and forgets it). `code` is a physical code such
   *  as "Enter", "Escape" or "KeyM". */
  consumePress(
    code: string
  ): boolean {

    return this.presses.delete(code);
  }

  /** Calls `callback` at every press of the key. Returns a
   *  function that stops it. */
  onPress(
    code: string,
    callback: () => void
  ): () => void {

    let set =
      this.listeners.get(code);

    if (!set) {

      set = new Set();

      this.listeners.set(code, set);
    }

    set.add(callback);

    return () => {
      set!.delete(callback);
    };
  }

  // ========================================
  // EVENTS
  // ========================================

  private readonly onKeyDown =
    (event: Event) => {

      const key =
        event as unknown as KeyEventLike;

      if (isTyping(key.target)) {
        return;
      }

      this.lastKey = describe(key);

      const code =
        physicalCode(key);

      if (!code) {
        return;
      }

      // Ctrl+W, Alt+Left, Cmd+A...: the browser's, not ours.
      if (
        key.ctrlKey ||
        key.metaKey ||
        key.altKey
      ) {
        return;
      }

      const isGameKey =
        GAME_CODES.has(code);

      // Space and the arrows must not scroll the page.
      if (
        isGameKey &&
        this.gameInput
      ) {
        key.preventDefault?.();
      }

      const wasDown =
        this.held.has(code);

      if (
        isGameKey &&
        this.gameInput
      ) {

        this.held.add(code);

        if (
          !wasDown &&
          !key.repeat &&
          ACTION_CODES.jump.includes(code)
        ) {
          this.jumpQueued = true;
        }
      }

      if (!key.repeat && !wasDown) {

        this.presses.add(code);

        for (
          const listener
          of this.listeners.get(code) ?? []
        ) {
          listener();
        }
      }
    };

  private readonly onKeyUp =
    (event: Event) => {

      // (no typing check: a key must always be let go)

      const code =
        physicalCode(
          event as unknown as KeyEventLike
        );

      if (code) {
        this.held.delete(code);
      }
    };

  private readonly reset =
    () => {

      this.held.clear();

      this.jumpQueued = false;
    };
}

/** The one in use by the game. */
export const controls =
  new Controls();
