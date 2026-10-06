import { test } from "vitest";
import assert from "node:assert/strict";
import {
  DAY_MS,
  compareDiners,
  parseLeaderboardWindow,
  rankDiners,
  standingLine,
  standingOf,
  verifiedLabel,
  weekEnd,
  weekStart,
  windowStart,
  type DinerScore,
} from "./leaderboard";

const diner = (handle: string, verified: number, places = verified): DinerScore => ({
  handle,
  displayName: null,
  avatarKey: null,
  verified,
  places,
});

test("the week runs Monday to Monday in UTC", () => {
  const wednesday = Date.UTC(2026, 8, 30, 12);
  assert.equal(weekStart(wednesday), Date.UTC(2026, 8, 28));
  assert.equal(weekEnd(wednesday), Date.UTC(2026, 9, 5));
  assert.equal(weekStart(Date.UTC(2026, 8, 28)), Date.UTC(2026, 8, 28));
  assert.equal(weekStart(Date.UTC(2026, 9, 4, 23, 59, 59)), Date.UTC(2026, 8, 28));
  assert.equal(weekStart(Date.UTC(2026, 9, 4, 23, 59, 59) + 1000), Date.UTC(2026, 9, 5));
  assert.equal(weekStart(Date.UTC(2026, 8, 27)), Date.UTC(2026, 8, 21)); // Sunday
});

test("only this week has a start, and unknown windows fall back to this week", () => {
  const now = Date.UTC(2026, 8, 30);
  assert.equal(windowStart("week", now), Date.UTC(2026, 8, 28));
  assert.equal(windowStart("all", now), null);
  assert.equal(parseLeaderboardWindow("all"), "all");
  assert.equal(parseLeaderboardWindow("month"), "week");
  assert.equal(parseLeaderboardWindow(undefined), "week");
  assert.equal(DAY_MS, 86_400_000);
});

test("ranking is by verified visits, then distinct places, then handle", () => {
  const ranked = rankDiners([
    diner("mariam", 3, 2),
    diner("zaid", 3, 3),
    diner("umar", 5),
    diner("anna", 3, 2),
    diner("nobody", 0),
  ]);
  assert.deepEqual(ranked.map((row) => [row.rank, row.handle]), [
    [1, "umar"],
    [2, "zaid"],
    [3, "anna"],
    [4, "mariam"],
  ]);
  assert.equal(compareDiners(diner("a", 1), diner("b", 1)) < 0, true);
  assert.deepEqual(rankDiners(ranked, 2).map((row) => row.handle), ["umar", "zaid"]);
});

test("a standing says how many more visits pass the next diner", () => {
  const ranked = rankDiners([diner("hafsa", 31), diner("umar", 24), diner("zaid", 19), diner("you", 6), diner("mariam", 8)]);
  const own = standingOf(ranked, "you");
  assert.equal(own.rank, 5);
  assert.deepEqual(own.nextAhead, { handle: "mariam", verified: 8 });
  assert.equal(own.toPass, 3);
  assert.equal(standingLine(own, "week"), "6 this week · 3 more to pass @mariam");

  const top = standingOf(ranked, "hafsa");
  assert.equal(top.rank, 1);
  assert.equal(top.toPass, null);
  assert.equal(standingLine(top, "all"), "31 verified · you’re in front");
});

test("someone off the board is measured against the last place", () => {
  const ranked = rankDiners([diner("a", 5), diner("b", 4)]);
  const off = standingOf(ranked, "c", 2);
  assert.equal(off.rank, null);
  assert.equal(off.verified, 2);
  assert.equal(off.toPass, 3);
  assert.equal(standingOf([], "c", 0).toPass, null);
  // A tie needs one more visit, not zero.
  assert.equal(standingOf(rankDiners([diner("a", 4), diner("b", 4)]), "b").toPass, 1);
});

test("labels read the way the design does", () => {
  assert.equal(verifiedLabel(31, "week"), "31 verified this week");
  assert.equal(verifiedLabel(31, "all"), "31 verified");
});
