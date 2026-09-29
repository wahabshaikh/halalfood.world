/**
 * The weekly logging streak.
 *
 * Log at least one visit in a calendar week (Monday to Sunday, in the diner's
 * local time) and the streak grows by one. Miss a whole week and it resets.
 *
 * Ramadan is handled by pausing rather than by excusing: a week that overlaps
 * Ramadan with no visit in it neither adds to the streak nor breaks it, because
 * dining out is naturally rarer while fasting. A visit in such a week still
 * counts, and iftar and sehri visits are ordinary visits like any other, so a
 * diner who eats out at iftar keeps building the streak through the month.
 *
 * Ramadan dates come from the Umm al-Qura calendar in the runtime's own ICU
 * data, so no table needs updating each year. That calendar can differ from a
 * local moon sighting by a day, which is well inside a week's tolerance.
 *
 * Only distinct weeks matter, so logging many visits in one week cannot
 * inflate the streak, and the streak never feeds a ranking or a halal status.
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** 1970-01-01 was a Thursday, so Monday-based weeks start three days earlier. */
const EPOCH_MONDAY_SHIFT = 3;
const RAMADAN_MONTH = 9;

let hijriMonth: Intl.DateTimeFormat | null | undefined;

function hijriMonthFormat(): Intl.DateTimeFormat | null {
  if (hijriMonth === undefined) {
    try {
      hijriMonth = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
        month: "numeric",
        timeZone: "UTC",
      });
    } catch {
      hijriMonth = null;
    }
  }
  return hijriMonth;
}

/** Days since 1970-01-01 in the diner's local calendar. */
export function localDay(timestamp: number, utcOffsetMinutes = 0): number {
  return Math.floor((timestamp + utcOffsetMinutes * MINUTE_MS) / DAY_MS);
}

/** Whole-week index, Monday-based, in the diner's local calendar. */
export function weekIndex(timestamp: number, utcOffsetMinutes = 0): number {
  return Math.floor((localDay(timestamp, utcOffsetMinutes) + EPOCH_MONDAY_SHIFT) / 7);
}

/** Is this local calendar day inside Ramadan? False when ICU lacks the calendar. */
export function isRamadanDay(day: number): boolean {
  const format = hijriMonthFormat();
  if (!format) return false;
  const month = Number.parseInt(format.format(new Date(day * DAY_MS + DAY_MS / 2)), 10);
  return month === RAMADAN_MONTH;
}

/** Does any day of this week fall in Ramadan? */
export function isRamadanWeek(week: number): boolean {
  const first = week * 7 - EPOCH_MONDAY_SHIFT;
  for (let offset = 0; offset < 7; offset += 1)
    if (isRamadanDay(first + offset)) return true;
  return false;
}

export type StreakState = {
  /** Consecutive kept weeks up to now, skipping paused Ramadan weeks. */
  current: number;
  longest: number;
  /** A visit is already logged this week. */
  keptThisWeek: boolean;
  /** This week overlaps Ramadan, so an empty week will not break the streak. */
  pausedThisWeek: boolean;
  /** A streak is running and this week still needs a visit to keep it. */
  atRisk: boolean;
  /** Whole days left in the week, counting today. */
  daysLeftThisWeek: number;
};

export function computeStreak(
  visitTimestamps: readonly number[],
  now: number = Date.now(),
  utcOffsetMinutes = 0,
): StreakState {
  const currentWeek = weekIndex(now, utcOffsetMinutes);
  const kept = new Set<number>();
  for (const timestamp of visitTimestamps) {
    if (!Number.isFinite(timestamp) || timestamp > now) continue;
    kept.add(weekIndex(timestamp, utcOffsetMinutes));
  }

  const paused = new Map<number, boolean>();
  const isPaused = (week: number) => {
    let value = paused.get(week);
    if (value === undefined) {
      value = isRamadanWeek(week);
      paused.set(week, value);
    }
    return value;
  };

  const keptThisWeek = kept.has(currentWeek);
  const pausedThisWeek = !keptThisWeek && isPaused(currentWeek);
  const earliest = kept.size ? Math.min(...kept) : currentWeek;

  // Walk backwards from the last finished week. The week in progress can add
  // to the streak once it has a visit, but never breaks it while it is empty.
  let current = keptThisWeek ? 1 : 0;
  for (let week = currentWeek - 1; week >= earliest; week -= 1) {
    if (kept.has(week)) current += 1;
    else if (!isPaused(week)) break;
  }

  let longest = 0;
  let run = 0;
  for (let week = earliest; week <= currentWeek; week += 1) {
    if (kept.has(week)) run += 1;
    else if (week === currentWeek || isPaused(week)) continue;
    else run = 0;
    longest = Math.max(longest, run);
  }

  const dayOfWeek =
    (localDay(now, utcOffsetMinutes) + EPOCH_MONDAY_SHIFT) % 7; // 0 = Monday
  return {
    current,
    longest: Math.max(longest, current),
    keptThisWeek,
    pausedThisWeek,
    atRisk: !keptThisWeek && !pausedThisWeek && current > 0,
    daysLeftThisWeek: 7 - dayOfWeek,
  };
}

/** One line for the "saved" screen and the feed header. */
export function streakLine(streak: StreakState): string {
  if (streak.current === 0)
    return streak.pausedThisWeek
      ? "Ramadan pause: no visit needed this week. Iftar and sehri visits still count."
      : "Log a visit this week to start a streak.";
  const weeks = `${streak.current}-week streak`;
  if (streak.atRisk) {
    const days =
      streak.daysLeftThisWeek === 1
        ? "today"
        : `in ${streak.daysLeftThisWeek} days`;
    return `${weeks}. Log a visit by the end of the week (${days}) to keep it.`;
  }
  if (streak.pausedThisWeek)
    return `${weeks}. Ramadan pause: this week can't break it, and iftar and sehri visits count.`;
  return `${weeks}. You've logged a visit this week.`;
}
