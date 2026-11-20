import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  emptyProfile,
  joinOptions,
  loadProfile,
  saveProfile
} from "../../client/src/profile.ts";

import {
  formatNames,
  formatTime,
  ordinal
} from "../../client/src/format.ts";

import type { KeyValueStorage } from "../../client/src/net/session.ts";

class MemoryStorage implements KeyValueStorage {

  data = new Map<string, string>();

  getItem(key: string) { return this.data.get(key) ?? null; }

  setItem(key: string, value: string) { this.data.set(key, value); }

  removeItem(key: string) { this.data.delete(key); }
}

describe("the remembered profile", () => {

  test("nothing saved means no choices", () => {

    assert.deepEqual(loadProfile(new MemoryStorage()), emptyProfile());
    assert.deepEqual(loadProfile(null), emptyProfile());
  });

  test("round trip", () => {

    const storage = new MemoryStorage();

    saveProfile({ name: "Aditya", color: 0xaa66ff }, storage);

    assert.deepEqual(loadProfile(storage), { name: "Aditya", color: 0xaa66ff });
  });

  test("what is saved is cleaned like the server cleans it", () => {

    const storage = new MemoryStorage();

    saveProfile({ name: "  <b>Eve</b>  ", color: 0x123456 }, storage);

    assert.deepEqual(loadProfile(storage), { name: "bEveb", color: null });
  });

  test("a hand-edited or damaged entry never gets through", () => {

    for (const raw of ["not json", "null", "[]", '{"name":5,"color":"red"}', '{"name":"<script>","color":99}', "{"]) {

      const storage = new MemoryStorage();

      storage.setItem("pico.profile", raw);

      const profile = loadProfile(storage);

      assert.ok(typeof profile.name === "string");
      assert.doesNotMatch(profile.name, /[<>]/);
      assert.ok(profile.color === null || typeof profile.color === "number");
    }

    const storage = new MemoryStorage();

    storage.setItem("pico.profile", '{"name":"Ok","color":16729156}');

    assert.deepEqual(loadProfile(storage), { name: "Ok", color: 0xff4444 });
  });

  test("storage that throws is harmless", () => {

    const broken: KeyValueStorage = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); }
    };

    assert.deepEqual(loadProfile(broken), emptyProfile());
    assert.doesNotThrow(() => saveProfile({ name: "x", color: null }, broken));
  });

  test("only real choices are sent when joining", () => {

    assert.deepEqual(joinOptions(emptyProfile()), {});
    assert.deepEqual(joinOptions({ name: "Ada", color: null }), { name: "Ada" });
    assert.deepEqual(joinOptions({ name: "", color: 0x44ddee }), { color: 0x44ddee });
    assert.deepEqual(joinOptions({ name: "Ada", color: 0x44ddee }), { name: "Ada", color: 0x44ddee });
    assert.deepEqual(joinOptions({ name: "😀", color: 7 }), {}, "nothing usable: nothing sent");
  });
});

describe("times and names on screen", () => {

  test("under a minute: seconds with a tenth", () => {

    assert.equal(formatTime(0), "0.0 s");
    assert.equal(formatTime(8_400), "8.4 s");
    assert.equal(formatTime(8_449), "8.4 s");
    assert.equal(formatTime(8_450), "8.5 s");
    assert.equal(formatTime(59_949), "59.9 s");
  });

  test("a minute and more: m:ss.t", () => {

    assert.equal(formatTime(60_000), "1:00.0");
    assert.equal(formatTime(62_300), "1:02.3");
    assert.equal(formatTime(125_000), "2:05.0");
    assert.equal(formatTime(59_960), "1:00.0", "rounds up into the next minute");
    assert.equal(formatTime(754_000), "12:34.0");
  });

  test("garbage shows as dashes", () => {

    for (const bad of [-1, NaN, Infinity, "5" as any, null as any, undefined as any]) {
      assert.equal(formatTime(bad), "--", String(bad));
    }
  });

  test("names are shortened with a count of the rest", () => {

    assert.equal(formatNames(["Ada"]), "Ada");
    assert.equal(formatNames(["Ada", "Sam"]), "Ada, Sam");
    assert.equal(formatNames(["Alexander", "Bartholomew", "Christopher", "Dominic"], 22), "Alexander +3");
    assert.equal(formatNames(["Alexander", "Bartholomew", "Chris"], 22), "Alexander +2");
    assert.equal(formatNames(["Ada", "Sam", "Bo", "Cy"], 22), "Ada, Sam, Bo, Cy");
    assert.equal(formatNames([], 22), "");
    assert.equal(formatNames(["x".repeat(40)], 22).length, 22);
  });

  test("ordinals", () => {

    const expected: Record<number, string> = {
      1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 10: "10th",
      11: "11th", 12: "12th", 13: "13th", 21: "21st", 22: "22nd",
      23: "23rd", 101: "101st", 111: "111th", 112: "112th"
    };

    for (const [n, text] of Object.entries(expected)) {
      assert.equal(ordinal(Number(n)), text);
    }
  });
});
