import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkInSheetReducer as reduce,
  initialCheckInSheet,
  type CheckInSheet,
  type CheckInSheetAction,
} from "../src/lib/check-in-draft";

function run(start: CheckInSheet, actions: CheckInSheetAction[]): CheckInSheet[] {
  const states: CheckInSheet[] = [];
  let state = start;
  for (const action of actions) {
    state = reduce(state, action);
    states.push(state);
  }
  return states;
}

test("open, tick, close and reopen in the same page session starts Share unticked", () => {
  const [opened, ticked, closed, reopened] = run(initialCheckInSheet(false), [
    { type: "open" },
    { type: "share", checked: true },
    { type: "close" },
    { type: "open" },
  ]);
  assert.deepEqual(opened, { phase: "open", shareToFeed: false });
  assert.equal(ticked.shareToFeed, true);
  assert.deepEqual(closed, { phase: "idle", shareToFeed: false });
  assert.deepEqual(reopened, { phase: "open", shareToFeed: false });
});

test("a failed send keeps the tick; a finished one and a bfcache restore clear it", () => {
  const states = run(initialCheckInSheet(true), [
    { type: "share", checked: true },
    { type: "saving" },
    { type: "failed" },
  ]);
  assert.deepEqual(states.at(-1), { phase: "open", shareToFeed: true });
  assert.equal(reduce(states.at(-1)!, { type: "pageshow", persisted: true }).shareToFeed, false);
  assert.equal(reduce(states.at(-1)!, { type: "pageshow", persisted: false }).shareToFeed, true);
  assert.deepEqual(reduce(states.at(-1)!, { type: "done" }), { phase: "done", shareToFeed: false });
  // Ticking is ignored while the sheet is closed.
  assert.equal(reduce(initialCheckInSheet(false), { type: "share", checked: true }).shareToFeed, false);
});

test("the check-in keeps Share in the sheet reducer, never in plain state that outlives a close", () => {
  const source = readFileSync(new URL("../app/place/[id]/place-check-in.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /useState\([^)]*\)[^\n]*shareToFeed|setShareToFeed/);
  assert.match(source, /useReducer\(checkInSheetReducer/);
  assert.match(source, /dispatchSheet\(\{ type: "open" \}\)/);
  assert.match(source, /dispatchSheet\(\{ type: "close" \}\)/);
  assert.match(source, /<form autoComplete="off"/);
  assert.match(source, /addEventListener\("pageshow"/);
});
