import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  findRoom,
  registerRoom,
  removeRoom,
  roomCodeExists,
  roomCount
} from "../src/roomRegistry.js";

process.env.LOG_LEVEL = "silent";

describe("room registry", () => {

  beforeEach(() => {

    for (const code of ["ABC123", "ZZZ999", "QWE456"]) {
      removeRoom(code);
    }
  });

  test("maps a room code to its room id", () => {

    registerRoom("ABC123", "room-1");

    assert.equal(findRoom("ABC123"), "room-1");
    assert.equal(roomCodeExists("ABC123"), true);
  });

  test("codes are normalised: case and surrounding spaces do not matter", () => {

    registerRoom(" abc123 ", "room-1");

    assert.equal(findRoom("ABC123"), "room-1");
    assert.equal(findRoom("abc123"), "room-1");
    assert.equal(findRoom("  Abc123"), "room-1");
    assert.equal(roomCodeExists("abc123"), true);
  });

  test("unknown codes are not found", () => {

    assert.equal(findRoom("NOPE00"), undefined);
    assert.equal(roomCodeExists("NOPE00"), false);
  });

  test("removing a room frees its code", () => {

    registerRoom("ZZZ999", "room-2");

    removeRoom("zzz999");

    assert.equal(findRoom("ZZZ999"), undefined);
    assert.equal(roomCodeExists("ZZZ999"), false);
  });

  test("keeps independent rooms apart and counts them", () => {

    const start = roomCount();

    registerRoom("ABC123", "room-1");
    registerRoom("QWE456", "room-3");

    assert.equal(findRoom("ABC123"), "room-1");
    assert.equal(findRoom("QWE456"), "room-3");
    assert.equal(roomCount(), start + 2);
  });
});
