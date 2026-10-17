import { test } from "vitest";
import assert from "node:assert/strict";
import { changeSentence, displayStatus, formatDay, formatIsoDate, isoToday, parseJsonObject, validUntilText } from "./display";

test("a recognition shows as expired only after the official list's own date", () => {
  assert.equal(displayStatus("recognised", "2030-06-30", "2026-10-17"), "recognised");
  assert.equal(displayStatus("recognised", "2026-10-16", "2026-10-17"), "expired");
  assert.equal(displayStatus("recognised", "2026-10-17", "2026-10-17"), "recognised", "valid through its last day");
  assert.equal(displayStatus("recognised", null, "2026-10-17"), "recognised");
  assert.equal(displayStatus("removed", "2020-01-01", "2026-10-17"), "removed");
});

test("valid-until text names the list's own date and never invents one", () => {
  assert.equal(validUntilText("2030-06-30", "2026-10-17"), "30 Jun 2030");
  assert.equal(validUntilText(null, "2026-10-17"), "No date on official list");
  assert.equal(validUntilText("2025-01-01", "2026-10-17"), "Expired 1 Jan 2025 (official list's own date)");
});

test("dates", () => {
  assert.equal(formatIsoDate("2026-10-17"), "17 Oct 2026");
  assert.equal(formatIsoDate("17/10/2026"), null);
  assert.equal(formatDay(Date.UTC(2026, 9, 17, 10)), "17 Oct 2026");
  assert.equal(formatDay(null), null);
  assert.equal(isoToday(new Date(Date.UTC(2026, 9, 17, 23, 59))), "2026-10-17");
});

test("each change reads as one plain sentence", () => {
  assert.equal(changeSentence("added", null, {}, "BPJPH"), "Added to BPJPH's list.");
  assert.equal(changeSentence("removed", {}, {}, "BPJPH"), "No longer on BPJPH's list.");
  assert.equal(changeSentence("scope_added", null, { added: ["cosmetics", "food"] }, "BPJPH"), "Scope added: Cosmetics, Food.");
  assert.equal(changeSentence("scope_removed", null, { removed: ["meat_slaughter"] }, "BPJPH"), "Scope removed: Slaughtering.");
  assert.equal(
    changeSentence("date_changed", { validUntil: "2028-02-20" }, { validUntil: "2030-06-30" }, "BPJPH"),
    "Valid until changed from 20 Feb 2028 to 30 Jun 2030.",
  );
  assert.equal(changeSentence("date_changed", { validUntil: null }, { validUntil: null }, "BPJPH"), "Valid until changed from no date on official list to no date on official list.");
  assert.equal(changeSentence("renamed", { name: "A" }, { name: "B" }, "BPJPH"), "Renamed from “A” to “B”.");
  assert.equal(changeSentence("status_changed", null, null, "BPJPH"), "Status changed.");
});

test("stored JSON objects parse, anything else is null", () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.equal(parseJsonObject("[1]"), null);
  assert.equal(parseJsonObject("{"), null);
  assert.equal(parseJsonObject(null), null);
});
