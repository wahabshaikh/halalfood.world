/**
 * Community contributions and the points they earn (spec §4).
 *
 * A contribution is a claim, not truth: who did what, where, how (channel)
 * and when, and it can be reverted. Points have no cash value and never
 * change trust weight, ranking or halal status.
 *
 * Points are granted only once a contribution is accepted: its points row is
 * pending until then, granted on acceptance and revoked if the contribution
 * is rejected or later reverted. A member earns at most 100 points a UTC day,
 * and some kinds have their own daily cap on how many awards pay.
 */

export const CONTRIBUTION_KINDS = [
  "vouch",
  "place_add",
  "video",
  "photo",
  "menu",
  "certificate",
  "owner_claim",
  "edit",
  "rating",
  "amenity",
  "hours",
  "link",
] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/** Informational only: MCP contributions earn exactly what web ones do. */
export const CHANNELS = ["web", "mcp", "scout"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CONTRIBUTION_STATUSES = ["pending", "accepted", "rejected", "reverted"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const POINT_STATUSES = ["pending", "granted", "revoked"] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

export const VOUCH_RATINGS = ["disliked", "liked", "loved"] as const;
export type VouchRating = (typeof VOUCH_RATINGS)[number];

export function parseContributionKind(value: unknown): ContributionKind | null {
  return CONTRIBUTION_KINDS.find((name) => name === value) ?? null;
}

export function parseChannel(value: unknown): Channel | null {
  return CHANNELS.find((name) => name === value) ?? null;
}

export function parseContributionStatus(value: unknown): ContributionStatus | null {
  return CONTRIBUTION_STATUSES.find((name) => name === value) ?? null;
}

export function parsePointStatus(value: unknown): PointStatus | null {
  return POINT_STATUSES.find((name) => name === value) ?? null;
}

export function parseVouchRating(value: unknown): VouchRating | null {
  return VOUCH_RATINGS.find((name) => name === value) ?? null;
}

/** Review moves: pending is accepted or rejected, and accepted work can be reverted. */
const NEXT_STATUS: Record<ContributionStatus, readonly ContributionStatus[]> = {
  pending: ["accepted", "rejected"],
  accepted: ["reverted"],
  rejected: [],
  reverted: [],
};

export function canMoveTo(from: ContributionStatus, to: ContributionStatus): boolean {
  return NEXT_STATUS[from].includes(to);
}

/** The points row follows its contribution. */
export function pointStatusFor(status: ContributionStatus): PointStatus {
  if (status === "accepted") return "granted";
  if (status === "pending") return "pending";
  return "revoked";
}

/** Most points a member can be granted in one UTC day. */
export const DAILY_POINTS_CAP = 100;

/** Extra points for each place published from a creator video. */
export const POINTS_PER_VIDEO_PLACE = 2;

/**
 * Points per kind, and how many awards of the kind's cap group pay per day
 * (null: no daily cap). Hours, links, amenities and edits share one cap.
 * Ratings never pay, so there is nothing to farm.
 */
export const POINT_RULES: Record<ContributionKind, { points: number; perDay: number | null; group: string }> = {
  vouch: { points: 3, perDay: null, group: "vouch" },
  place_add: { points: 5, perDay: 10, group: "place_add" },
  video: { points: 5, perDay: 10, group: "video" },
  photo: { points: 1, perDay: 10, group: "photo" },
  menu: { points: 5, perDay: 5, group: "menu" },
  certificate: { points: 10, perDay: 5, group: "certificate" },
  owner_claim: { points: 10, perDay: null, group: "owner_claim" },
  hours: { points: 1, perDay: 20, group: "details" },
  link: { points: 1, perDay: 20, group: "details" },
  amenity: { points: 1, perDay: 20, group: "details" },
  edit: { points: 1, perDay: 20, group: "details" },
  rating: { points: 0, perDay: null, group: "rating" },
};

/** What the member was already granted today, counted by the caller. */
export type GrantedToday = {
  /** Points granted today. */
  points: number;
  /** Awards granted today in this kind's cap group (`POINT_RULES[kind].group`). */
  awards: number;
};

/**
 * Points to grant when a contribution is accepted. A vouch pays once per
 * place, ever (`paidBefore`); a video pays 2 more per place published from
 * it. A kind's daily cap stops further awards, and the 100-point day cap
 * trims the last award so the day ends on exactly 100.
 */
export function pointsToGrant(
  kind: ContributionKind,
  today: GrantedToday,
  options: { paidBefore?: boolean; placesPublished?: number } = {},
): number {
  const rule = POINT_RULES[kind];
  if (kind === "vouch" && options.paidBefore) return 0;
  if (rule.perDay !== null && today.awards >= rule.perDay) return 0;
  const points = rule.points + (kind === "video" ? POINTS_PER_VIDEO_PLACE * Math.max(0, options.placesPublished ?? 0) : 0);
  return Math.max(0, Math.min(points, DAILY_POINTS_CAP - today.points));
}
