import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  copyToClipboard,
  type DocumentLike,
  type TextareaLike
} from "../../client/src/net/clipboard.ts";

// A fake page: records what the old-style copy did.
function fakeDocument(options: { copyWorks?: boolean; throws?: boolean } = {}) {

  const log = {
    appended: 0,
    removed: 0,
    selected: "",
    commands: [] as string[],
    atCopyTime: "" as string
  };

  let current: TextareaLike | null = null;

  const doc: DocumentLike = {

    body: {
      appendChild() {
        log.appended++;
      }
    },

    createElement() {

      current = {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {
          log.selected = current!.value;
        },
        setSelectionRange() {},
        remove() {
          log.removed++;
        }
      };

      return current;
    },

    execCommand(command) {

      log.commands.push(command);

      if (options.throws) {
        throw new Error("denied");
      }

      log.atCopyTime = current!.value;

      return options.copyWorks ?? true;
    }
  };

  return { doc, log };
}

describe("copying the room code", () => {

  test("uses the clipboard when the browser allows it", async () => {

    let written = "";

    const { doc, log } = fakeDocument();

    const ok = await copyToClipboard("ABC123", {
      clipboard: { writeText: async (text) => { written = text; } },
      document: doc
    });

    assert.equal(ok, true);
    assert.equal(written, "ABC123");
    assert.equal(log.commands.length, 0, "the old way is not needed");
  });

  test("falls back to selecting hidden text when the clipboard API is missing (plain http)", async () => {

    const { doc, log } = fakeDocument();

    const ok = await copyToClipboard("ABC123", { clipboard: undefined, document: doc });

    assert.equal(ok, true);
    assert.deepEqual(log.commands, ["copy"]);
    assert.equal(log.atCopyTime, "ABC123", "the code was in the selected text");
    assert.equal(log.selected, "ABC123");
    assert.equal(log.appended, 1);
    assert.equal(log.removed, 1, "the hidden box is cleaned up");
  });

  test("falls back when the clipboard API refuses", async () => {

    const { doc, log } = fakeDocument();

    const ok = await copyToClipboard("ABC123", {
      clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } },
      document: doc
    });

    assert.equal(ok, true);
    assert.equal(log.atCopyTime, "ABC123");
  });

  test("reports failure when nothing works, and never throws", async () => {

    const refusing = { writeText: async () => { throw new Error("no"); } };

    assert.equal(
      await copyToClipboard("ABC123", { clipboard: refusing, document: fakeDocument({ copyWorks: false }).doc }),
      false,
      "the browser says the copy command did nothing"
    );

    const broken = fakeDocument({ throws: true });

    assert.equal(
      await copyToClipboard("ABC123", { clipboard: refusing, document: broken.doc }),
      false
    );

    assert.equal(broken.log.removed, 1, "still cleaned up after an error");

    assert.equal(await copyToClipboard("ABC123", {}), false, "no browser at all");
  });

  test("an empty code is never copied", async () => {

    let called = false;

    const ok = await copyToClipboard("", {
      clipboard: { writeText: async () => { called = true; } },
      document: fakeDocument().doc
    });

    assert.equal(ok, false);
    assert.equal(called, false);
  });
});
