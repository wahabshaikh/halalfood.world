import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkInSheetReducer as reduce,
  initialCheckInSheet,
  shareTicked,
  type CheckInSheet,
  type CheckInSheetAction,
} from "../src/lib/check-in-draft";

function run(start: CheckInSheet, actions: CheckInSheetAction[]): CheckInSheet {
  return actions.reduce(reduce, start);
}

const TICK: CheckInSheetAction = { type: "share", checked: true };

for (const via of ["button", "escape"] as const) {
  test(`open, tick, close by ${via === "button" ? "the X" : "Escape"}, reopen: Share starts unticked`, () => {
    const opened = run(initialCheckInSheet(false), [{ type: "open" }]);
    assert.equal(shareTicked(opened), false);
    const ticked = reduce(opened, TICK);
    assert.equal(shareTicked(ticked), true);
    const closed = reduce(ticked, { type: "close", via });
    assert.equal(closed.phase, "idle");
    assert.equal(shareTicked(closed), false);
    const reopened = reduce(closed, { type: "open" });
    assert.equal(reopened.phase, "open");
    assert.equal(shareTicked(reopened), false, "a tick from the last session never counts");
    assert.notEqual(reopened.session, ticked.session, "the form is keyed by a new session");
  });
}

test("the sheet starting open (the log-a-visit page) behaves the same", () => {
  const state = run(initialCheckInSheet(true), [TICK, { type: "close", via: "escape" }, { type: "open" }]);
  assert.equal(shareTicked(state), false);
});

test("no sequence of closes and reopens brings a tick back", () => {
  const closers: CheckInSheetAction[] = [
    { type: "close", via: "button" },
    { type: "close", via: "escape" },
    { type: "done" },
    { type: "pageshow", persisted: true },
  ];
  for (const closer of closers)
    for (const reopen of [[{ type: "open" }], [{ type: "open" }, { type: "open" }]] as CheckInSheetAction[][]) {
      const state = run(initialCheckInSheet(false), [{ type: "open" }, TICK, closer, ...reopen]);
      assert.equal(shareTicked(state), false, `${JSON.stringify(closer)} then reopen`);
    }
});

test("a failed send keeps the tick for the retry; a finished one and a bfcache restore clear it", () => {
  const failed = run(initialCheckInSheet(true), [TICK, { type: "saving" }, { type: "failed" }]);
  assert.equal(failed.phase, "open");
  assert.equal(shareTicked(failed), true);
  assert.equal(shareTicked(reduce(failed, { type: "pageshow", persisted: true })), false);
  assert.equal(shareTicked(reduce(failed, { type: "pageshow", persisted: false })), true);
  assert.equal(shareTicked(reduce(failed, { type: "done" })), false);
  // Ticking is ignored while the sheet is closed.
  assert.equal(shareTicked(reduce(initialCheckInSheet(false), TICK)), false);
});

test("the check-in has one close path, keyed form state and an Escape handler", () => {
  const source = readFileSync(new URL("../app/place/[id]/place-check-in.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /useState\([^)]*\)[^\n]*shareToFeed|setShareToFeed/);
  assert.match(source, /useReducer\(checkInSheetReducer/);
  assert.equal(source.match(/type: "close"/g)?.length, 1, "only closeSheet dispatches a close");
  assert.match(source, /closeSheet\("button"\)/);
  assert.match(source, /closeSheet\("escape"\)/);
  assert.match(source, /<form key=\{session\} autoComplete="off"/);
  assert.match(source, /key=\{`share-\$\{session\}`\}/);
  assert.match(source, /shareToFeed = shareTicked\(sheet\)/);
  assert.match(source, /addEventListener\("pageshow"/);
});
