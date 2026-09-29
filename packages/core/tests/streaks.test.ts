import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStreak,
  isRamadanDay,
  isRamadanWeek,
  localDay,
  streakLine,
  weekIndex,
} from "../src/streaks";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

test("weeks run Monday to Sunday", () => {
  const monday = at("2026-09-21T00:00:00Z");
  assert.equal(new Date(monday).getUTCDay(), 1);
  assert.equal(weekIndex(monday), weekIndex(monday + 6 * DAY + 23 * 3_600_000));
  assert.equal(weekIndex(monday) + 1, weekIndex(monday + 7 * DAY));
  assert.equal(weekIndex(monday - 1) + 1, weekIndex(monday));
});

test("the diner's own timezone decides where a week ends", () => {
  const sundayLate = at("2026-09-27T23:30:00Z");
  const monday = weekIndex(sundayLate + 3_600_000);
  assert.equal(weekIndex(sundayLate), monday - 1);
  // In UTC+5:30 the same instant is already Monday morning.
  assert.equal(weekIndex(sundayLate, 330), monday);
  assert.equal(localDay(sundayLate, 330), localDay(sundayLate) + 1);
});

test("consecutive weeks build a streak and repeat visits in a week add nothing", () => {
  const now = at("2026-09-30T10:00:00Z"); // Wednesday
  const streak = computeStreak(
    [
      at("2026-09-29T09:00:00Z"),
      at("2026-09-28T09:00:00Z"),
      at("2026-09-22T09:00:00Z"),
      at("2026-09-15T09:00:00Z"),
    ],
    now,
  );
  assert.equal(streak.current, 3);
  assert.equal(streak.keptThisWeek, true);
  assert.equal(streak.atRisk, false);
});

test("an empty week in progress does not break the streak but puts it at risk", () => {
  const now = at("2026-09-30T10:00:00Z");
  const streak = computeStreak(
    [at("2026-09-22T09:00:00Z"), at("2026-09-15T09:00:00Z")],
    now,
  );
  assert.equal(streak.current, 2);
  assert.equal(streak.keptThisWeek, false);
  assert.equal(streak.atRisk, true);
  assert.equal(streak.daysLeftThisWeek, 5);
});

test("a finished empty week resets the streak", () => {
  const now = at("2026-09-30T10:00:00Z");
  const streak = computeStreak(
    [at("2026-09-08T09:00:00Z"), at("2026-09-01T09:00:00Z")],
    now,
  );
  assert.equal(streak.current, 0);
  assert.equal(streak.longest, 2);
  assert.equal(streak.atRisk, false);
});

test("future timestamps and no visits at all are handled", () => {
  const now = at("2026-09-30T10:00:00Z");
  assert.equal(computeStreak([now + 10 * DAY], now).current, 0);
  const empty = computeStreak([], now);
  assert.deepEqual([empty.current, empty.longest, empty.atRisk], [0, 0, false]);
});

test("Ramadan is found from the calendar, not a table", () => {
  // Ramadan 1447 began around 18 February 2026 and ended around 19 March.
  assert.equal(isRamadanDay(localDay(at("2026-02-25T00:00:00Z"))), true);
  assert.equal(isRamadanDay(localDay(at("2026-02-10T00:00:00Z"))), false);
  assert.equal(isRamadanDay(localDay(at("2026-09-30T00:00:00Z"))), false);
  assert.equal(isRamadanWeek(weekIndex(at("2026-03-02T00:00:00Z"))), true);
});

test("an empty Ramadan week pauses the streak instead of breaking it", () => {
  // Kept the week of 9 Feb, nothing 16 and 23 Feb or 2 Mar (Ramadan), then back.
  const visits = [
    at("2026-02-10T12:00:00Z"),
    at("2026-03-10T12:00:00Z"),
    at("2026-03-17T12:00:00Z"),
  ];
  const during = computeStreak(visits, at("2026-03-18T12:00:00Z"));
  // 17 Mar week, 10 Mar week, then the paused weeks, then 9 Feb week.
  assert.equal(during.current, 3);
  assert.equal(during.longest, 3);
});

test("a paused Ramadan week never adds to the streak, but a visit in it does", () => {
  const now = at("2026-03-04T12:00:00Z"); // Wednesday in Ramadan
  const empty = computeStreak([at("2026-02-24T12:00:00Z")], now);
  assert.equal(empty.pausedThisWeek, true);
  assert.equal(empty.atRisk, false);
  assert.equal(empty.current, 1);

  const iftar = computeStreak(
    [at("2026-02-24T12:00:00Z"), at("2026-03-03T17:00:00Z")],
    now,
  );
  assert.equal(iftar.keptThisWeek, true);
  assert.equal(iftar.pausedThisWeek, false);
  assert.equal(iftar.current, 2);
});

test("a gap outside Ramadan still breaks the streak after Ramadan", () => {
  const visits = [at("2026-02-10T12:00:00Z"), at("2026-04-07T12:00:00Z")];
  // The week of 13 Apr is empty and well past Ramadan's end, so it breaks.
  const streak = computeStreak(visits, at("2026-04-22T12:00:00Z"));
  assert.equal(streak.current, 0);
  assert.equal(streak.longest, 1);
});

test("streakLine says plainly what happens next", () => {
  const now = at("2026-09-30T10:00:00Z");
  assert.match(
    streakLine(computeStreak([at("2026-09-22T09:00:00Z")], now)),
    /Log a visit by the end of the week/,
  );
  assert.match(streakLine(computeStreak([], now)), /start a streak/);
  assert.match(
    streakLine(computeStreak([at("2026-09-29T09:00:00Z")], now)),
    /1-week streak/,
  );
});
