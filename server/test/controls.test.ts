import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  Controls,
  physicalCode
} from "../../client/src/input/Controls.ts";

// A stand-in for the window: events are dispatched on it the way a browser
// would, with the properties a KeyboardEvent has.

let target: EventTarget;

let controls: Controls;

function key(
  type: "keydown" | "keyup",
  init: {
    code?: string;
    key?: string;
    keyCode?: number;
    repeat?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
  onTarget: EventTarget = target
): boolean {

  const event = new Event(type, { cancelable: true });

  Object.assign(event, init);

  onTarget.dispatchEvent(event);

  return event.defaultPrevented;
}

const down = (code: string, extra: object = {}) =>
  key("keydown", { code, key: code.replace("Key", "").toLowerCase(), ...extra });

const up = (code: string) =>
  key("keyup", { code });

beforeEach(() => {

  target = new EventTarget();

  controls = new Controls();

  controls.attach(target);
});

describe("which key was it", () => {

  test("the physical key is used when the browser gives it", () => {

    assert.equal(physicalCode({ code: "KeyA", key: "a", keyCode: 65 }), "KeyA");
    assert.equal(physicalCode({ code: "KeyD", key: "द", keyCode: 229 }), "KeyD", "a Devanagari letter on the D key");
    assert.equal(physicalCode({ code: "KeyA", key: "q", keyCode: 81 }), "KeyA", "AZERTY: the key labelled Q is where A is");
    assert.equal(physicalCode({ code: "Space", key: " ", keyCode: 32 }), "Space");
    assert.equal(physicalCode({ code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 }), "ArrowLeft");
  });

  test("without a code, the typed character is used", () => {

    assert.equal(physicalCode({ key: "d" }), "KeyD");
    assert.equal(physicalCode({ key: "D" }), "KeyD");
    assert.equal(physicalCode({ key: " " }), "Space");
    assert.equal(physicalCode({ code: "", key: "w" }), "KeyW");
    assert.equal(physicalCode({ code: "Unidentified", key: "a" }), "KeyA");
    assert.equal(physicalCode({ key: "ArrowRight" }), "ArrowRight");
    assert.equal(physicalCode({ key: "Left" }), "ArrowLeft", "an old browser's name");
    assert.equal(physicalCode({ key: "Esc" }), "Escape");
  });

  test("and as the very last resort the old number", () => {

    assert.equal(physicalCode({ keyCode: 68 }), "KeyD");
    assert.equal(physicalCode({ key: "Unidentified", keyCode: 87 }), "KeyW");
    assert.equal(physicalCode({ keyCode: 13 }), "Enter");
  });

  test("what cannot be told is empty", () => {

    assert.equal(physicalCode({ key: "Process", keyCode: 229 }), "", "an input method with nothing else to go by");
    assert.equal(physicalCode({}), "");
    assert.equal(physicalCode({ key: "द" }), "", "a letter that is not on the A-Z keys, with no code");
  });
});

describe("moving", () => {

  test("A and D, and the arrows", () => {

    assert.equal(controls.left, false);

    down("KeyA");

    assert.equal(controls.left, true);
    assert.equal(controls.right, false);

    up("KeyA");
    down("KeyD");

    assert.equal(controls.left, false);
    assert.equal(controls.right, true);

    up("KeyD");
    down("ArrowLeft");

    assert.equal(controls.left, true);

    up("ArrowLeft");

    assert.equal(controls.left, false);
  });

  test("it works WHATEVER keyCode the browser reports: this is the Chrome bug", () => {

    // 229 while an input method is active, 0, or another letter's number
    for (const keyCode of [229, 0, 81, undefined]) {

      down("KeyD", { keyCode, key: "Process" });

      assert.equal(controls.right, true, `keyCode ${keyCode}`);

      up("KeyD");

      assert.equal(controls.right, false);
    }
  });

  test("it works with a non-Latin letter on the key (Hindi layout)", () => {

    key("keydown", { code: "KeyA", key: "ब", keyCode: 65 });

    assert.equal(controls.left, true);

    key("keyup", { code: "KeyA", key: "ब" });

    assert.equal(controls.left, false);
  });

  test("it works on an AZERTY keyboard: the keys in the WASD places", () => {

    // physical A, D and W positions print Q, D and Z there
    key("keydown", { code: "KeyA", key: "q", keyCode: 81 });
    assert.equal(controls.left, true);
    key("keyup", { code: "KeyA", key: "q" });

    key("keydown", { code: "KeyW", key: "z", keyCode: 90 });
    assert.equal(controls.consumeJump(), true);
  });

  test("a browser that gives no code at all still works", () => {

    key("keydown", { key: "a" });

    assert.equal(controls.left, true);

    key("keyup", { key: "a" });

    assert.equal(controls.left, false);
  });

  test("both directions held: both are reported (the server picks)", () => {

    down("KeyA");
    down("KeyD");

    assert.equal(controls.left, true);
    assert.equal(controls.right, true);
  });

  test("two keys for one direction: it stays down until both are released", () => {

    down("KeyA");
    down("ArrowLeft");

    up("KeyA");

    assert.equal(controls.left, true);

    up("ArrowLeft");

    assert.equal(controls.left, false);
  });
});

describe("jumping", () => {

  test("W, Space and Up each jump, once per press", () => {

    for (const code of ["KeyW", "Space", "ArrowUp"]) {

      assert.equal(controls.consumeJump(), false);

      down(code);

      assert.equal(controls.consumeJump(), true, code);
      assert.equal(controls.consumeJump(), false, `${code}: only once`);

      up(code);
    }
  });

  test("holding the key does not jump again (key repeat)", () => {

    down("Space");

    assert.equal(controls.consumeJump(), true);

    down("Space", { repeat: true });
    down("Space", { repeat: true });
    down("Space");

    assert.equal(controls.consumeJump(), false, "still held: no new jump");

    up("Space");
    down("Space");

    assert.equal(controls.consumeJump(), true, "a new press jumps");
  });

  test("a jump pressed and released between two frames is not lost", () => {

    down("KeyW");
    up("KeyW");

    assert.equal(controls.consumeJump(), true);
  });
});

describe("what it leaves alone", () => {

  test("typing in a text box is not playing", () => {

    const input = new EventTarget() as EventTarget & { tagName: string };

    input.tagName = "INPUT";

    const event = new Event("keydown", { cancelable: true });

    Object.assign(event, { code: "KeyA", key: "a" });

    // dispatched on the input, but seen by the window's listener
    Object.defineProperty(event, "target", { value: input });

    target.dispatchEvent(event);

    assert.equal(controls.left, false);

    assert.equal(event.defaultPrevented, false, "the letter still reaches the box");
  });

  test("shortcuts of the browser are left to it", () => {

    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {

      const prevented = down("KeyW", mods);

      assert.equal(controls.consumeJump(), false, JSON.stringify(mods));
      assert.equal(prevented, false);
    }
  });

  test("Space and the arrows do not scroll the page, other keys are left alone", () => {

    assert.equal(down("Space"), true);
    assert.equal(down("ArrowDown"), false, "down is not a game key");
    assert.equal(down("KeyQ"), false);
    assert.equal(down("Tab"), false);
  });

  test("losing the window releases everything", () => {

    down("KeyA");
    down("KeyD");
    down("Space");

    target.dispatchEvent(new Event("blur"));

    assert.equal(controls.left, false);
    assert.equal(controls.right, false);
    assert.equal(controls.consumeJump(), false);
  });
});

describe("while a menu is open", () => {

  test("movement keys do nothing, and nothing is stuck afterwards", () => {

    down("KeyD");

    controls.setGameInput(false);

    assert.equal(controls.right, false);

    down("Space");

    assert.equal(controls.consumeJump(), false);

    controls.setGameInput(true);

    assert.equal(controls.right, false, "the key held before is not remembered");

    down("KeyD");

    assert.equal(controls.right, true);
  });

  test("single presses (Escape) still arrive", () => {

    let escapes = 0;

    controls.onPress("Escape", () => escapes++);

    controls.setGameInput(false);

    down("Escape");
    down("Escape", { repeat: true });
    up("Escape");
    down("Escape");

    assert.equal(escapes, 2, "twice: the repeat does not count");
  });
});

describe("single presses", () => {

  test("Enter, Escape and M are reported once, whatever the keyCode", () => {

    for (const code of ["Enter", "Escape", "KeyM"]) {

      assert.equal(controls.consumePress(code), false);

      key("keydown", { code, key: "Process", keyCode: 229 });

      assert.equal(controls.consumePress(code), true, code);
      assert.equal(controls.consumePress(code), false, `${code}: forgotten once asked`);

      up(code);
    }
  });

  test("listeners hear it, and can be removed", () => {

    let heard = 0;

    const stop = controls.onPress("KeyM", () => heard++);

    down("KeyM");
    up("KeyM");
    down("KeyM");
    up("KeyM");

    assert.equal(heard, 2);

    stop();

    down("KeyM");

    assert.equal(heard, 2);
  });
});

describe("diagnostics and clean-up", () => {

  test("it remembers what the last key looked like", () => {

    key("keydown", { code: "KeyD", key: "Process", keyCode: 229 });

    assert.match(controls.lastKey, /KeyD/);
    assert.match(controls.lastKey, /Process/);
    assert.match(controls.lastKey, /229/);
  });

  test("detaching stops listening and lets go of everything", () => {

    down("KeyA");

    controls.detach();

    assert.equal(controls.left, false);

    down("KeyD");

    assert.equal(controls.right, false);
  });

  test("attaching twice does not double the events", () => {

    controls.attach(target);

    let heard = 0;

    controls.onPress("KeyM", () => heard++);

    down("KeyM");

    assert.equal(heard, 1);
  });

  test("an unknown or odd event never throws", () => {

    assert.doesNotThrow(() => {
      key("keydown", {});
      key("keydown", { key: "Process", keyCode: 229 });
      key("keyup", {});
      target.dispatchEvent(new Event("keydown"));
    });
  });
});
