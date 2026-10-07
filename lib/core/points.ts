/** Community points (spec §10). Points rank people; they never touch halal status. */
export const POINTS = {
  check: 3,
  "place-added": 5,
  "helped-verify": 10,
} as const;

export type PointKind = keyof typeof POINTS;

/** The UTC day a point belongs to. One award per kind, place and person per day. */
export function pointDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Monday 00:00 UTC of the week containing `at`. */
export function weekStart(at: number): number {
  const date = new Date(at);
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}
