import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NAME_MAX,
  PALETTE,
  defaultName,
  isPaletteColor,
  pickColor,
  sanitizeName,
  uniqueName
} from "../src/profile.js";

describe("names", () => {

  test("ordinary names pass through", () => {

    assert.equal(sanitizeName("Aditya"), "Aditya");
    assert.equal(sanitizeName("Mr. Jump-man"), "Mr. Jump-man");
    assert.equal(sanitizeName("player_1"), "player_1");
    assert.equal(sanitizeName("It's me!"), "It's me!");
  });

  test("other languages are fine", () => {

    assert.equal(sanitizeName("राहुल"), "राहुल");
    assert.equal(sanitizeName("José"), "José");
    assert.equal(sanitizeName("名前"), "名前");
    assert.equal(sanitizeName("Zoë 7"), "Zoë 7");
  });

  test("whitespace is tidied and names are one line", () => {

    assert.equal(sanitizeName("   Bob   "), "Bob");
    assert.equal(sanitizeName("a    b"), "a b");
    assert.equal(sanitizeName("line\none"), "line one");
    assert.equal(sanitizeName("tab\tbed"), "tab bed");
  });

  test("they are cut to the maximum length", () => {

    const long = "abcdefghijklmnopqrstuvwxyz";

    assert.equal(sanitizeName(long), long.slice(0, NAME_MAX));
    assert.equal(sanitizeName(long).length, NAME_MAX);
    assert.equal(sanitizeName("a".repeat(11) + " " + "b".repeat(5)), "a".repeat(11), "no trailing space left behind");
  });

  test("markup, quotes, emoji and control characters are removed", () => {

    // the brackets and parentheses go; what is left is cut to the maximum length
    assert.equal(sanitizeName("<script>alert(1)</script>"), "scriptalert1");
    assert.equal(sanitizeName("<b>hi</b>"), "bhib");
    assert.equal(sanitizeName('"; DROP TABLE'), "DROP TABLE");
    assert.equal(sanitizeName("a&b<c>d"), "abcd");
    assert.equal(sanitizeName("😀Bob😀"), "Bob");
    assert.equal(sanitizeName("bo\u0000b"), "bob");
    assert.equal(sanitizeName("bo​b"), "bob", "zero-width space");
    assert.equal(sanitizeName("‮evil"), "evil", "right-to-left override");
    assert.equal(sanitizeName("a\u0007b"), "ab", "bell");
  });

  test("combining marks stay with their letters, but cannot be piled up", () => {

    // Hindi, Tamil and Thai need their vowel signs
    assert.equal(sanitizeName("राहुल"), "राहुल");
    assert.equal(sanitizeName("தமிழ்"), "தமிழ்");
    assert.equal(sanitizeName("สวัสดี"), "สวัสดี");

    // "zalgo" text: dozens of marks on one letter
    const zalgo = "Z" + "̀́̂̃̄̅̆̇̈".repeat(5) + "algo";

    const cleaned = sanitizeName(zalgo);

    assert.ok(cleaned.length <= NAME_MAX);
    assert.ok(cleaned.endsWith("algo") || cleaned.length === NAME_MAX);
    assert.equal(
      (cleaned.match(/\p{M}/gu) ?? []).length <= 2,
      true,
      "at most two marks per letter survive"
    );

    // a mark with nothing to sit on is dropped
    assert.equal(sanitizeName("́abc"), "abc");
    assert.equal(sanitizeName("a ́b"), "a b");
  });

  test("full-width and compatibility characters are normalised", () => {

    assert.equal(sanitizeName("ＢＯＢ"), "BOB");
  });

  test("nothing usable means empty (the caller picks a default)", () => {

    for (const raw of ["", "   ", "<<<>>>", "😀😀", "\n\t", null, undefined, 42, {}, [], true]) {
      assert.equal(sanitizeName(raw), "", String(raw));
    }
  });

  test("it is idempotent", () => {

    for (const raw of ["  Weird   <b>Name</b>!! ", "José  María", "x".repeat(40)]) {

      const once = sanitizeName(raw);

      assert.equal(sanitizeName(once), once);
    }
  });

  test("default names count from 1", () => {

    assert.equal(defaultName(0), "Player 1");
    assert.equal(defaultName(3), "Player 4");
  });
});

describe("unique names", () => {

  test("a free name is kept", () => {

    assert.equal(uniqueName("Bob", ["Alice"]), "Bob");
    assert.equal(uniqueName("Bob", []), "Bob");
  });

  test("a taken name gets a number, ignoring case", () => {

    assert.equal(uniqueName("Bob", ["bob"]), "Bob 2");
    assert.equal(uniqueName("Bob", ["Bob", "Bob 2"]), "Bob 3");
    assert.equal(uniqueName("BOB", ["Bob", "bob 2", "Bob 3"]), "BOB 4");
  });

  test("the numbered name still fits", () => {

    const long = "abcdefghijkl";

    assert.equal(long.length, NAME_MAX);

    const result = uniqueName(long, [long]);

    assert.ok(result.length <= NAME_MAX, result);
    assert.equal(result, "abcdefghij 2");
  });
});

describe("colours", () => {

  test("the palette is eight distinct, valid colours starting with the four originals", () => {

    assert.equal(PALETTE.length, 8);
    assert.equal(new Set(PALETTE).size, 8);

    assert.deepEqual(
      PALETTE.slice(0, 4),
      [0xff4444, 0x4488ff, 0x44cc66, 0xffcc33]
    );

    for (const color of PALETTE) {
      assert.ok(Number.isInteger(color) && color > 0 && color <= 0xffffff);
    }
  });

  test("a requested free colour is given", () => {

    assert.equal(pickColor(0xaa66ff, [], 0), 0xaa66ff);
    assert.equal(pickColor(0xaa66ff, [0xff4444], 1), 0xaa66ff);
  });

  test("a taken colour is not: the seat's own colour is used instead", () => {

    assert.equal(pickColor(0xff4444, [0xff4444], 1), 0x4488ff);
    assert.equal(pickColor(0xff4444, [0xff4444, 0x4488ff], 1), 0x44cc66);
  });

  test("without a request the seat's own colour is the default", () => {

    for (let seat = 0; seat < 4; seat++) {
      assert.equal(pickColor(undefined, [], seat), PALETTE[seat]);
    }
  });

  test("an invalid request falls back to a free colour", () => {

    for (const bad of [0x123456, -1, NaN, "red", null, {}, 1e99, "0xff4444"]) {
      assert.ok(isPaletteColor(pickColor(bad, [], 2)), String(bad));
      assert.equal(pickColor(bad, [], 2), PALETTE[2]);
    }
  });

  test("the first free colour is found wherever the seat starts, and wraps", () => {

    assert.equal(pickColor(undefined, [PALETTE[7]], 7), PALETTE[0]);
    assert.equal(pickColor(undefined, [PALETTE[0], PALETTE[1]], 0), PALETTE[2]);
  });

  test("four players never get the same colour", () => {

    const taken: number[] = [];

    for (let seat = 0; seat < 4; seat++) {

      // everybody asks for the same colour
      taken.push(pickColor(0xff4444, taken, seat));
    }

    assert.equal(new Set(taken).size, 4);
  });

  test("isPaletteColor", () => {

    assert.equal(isPaletteColor(0xff4444), true);
    assert.equal(isPaletteColor(0x000000), false);
    assert.equal(isPaletteColor("0xff4444"), false);
  });
});
