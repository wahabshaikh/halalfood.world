/**
 * Rules for the activity feed behind the bell.
 *
 * A notification only ever says what a person did ("Zaid visited...") or what
 * moderators decided ("Your halal check was approved"). The one alert only we
 * can send, a halal status changing at a place someone saved, is worded from
 * the status history and links back to the evidence. Nothing here can change a
 * status: it only reports one.
 */

import { STATUS_COPY, HALAL_STATUSES, type HalalTaxonomyStatus } from "./halal-taxonomy";

export const NOTIFICATION_KINDS = [
  "status-changed",
  "check-reviewed",
  "follow",
  "follow-request",
  "follow-accepted",
  "like",
  "comment",
  "friend-visit",
  "list-invite",
  "list-places-added",
  "rec",
  "rec-reply",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** The tabs on the activity page. */
export const NOTIFICATION_FILTERS = ["all", "halal", "follows"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const NOTIFICATION_FILTER_LABELS: Record<NotificationFilter, string> = {
  all: "All",
  halal: "Halal updates",
  follows: "Follows",
};

export function parseNotificationFilter(value: unknown): NotificationFilter {
  return (NOTIFICATION_FILTERS as readonly unknown[]).includes(value)
    ? (value as NotificationFilter)
    : "all";
}

/** Kinds shown under a tab, or null for every kind. */
export function kindsForFilter(filter: NotificationFilter): readonly NotificationKind[] | null {
  if (filter === "halal") return ["status-changed", "check-reviewed"];
  if (filter === "follows") return ["follow", "follow-request", "follow-accepted"];
  return null;
}

/** Newest rows read per page, before likes are folded together. */
export const NOTIFICATION_PAGE_SIZE = 60;

/**
 * Whether a change of derived status is worth an alert. A change of confidence
 * inside the same status is not, and a place with no history yet is treated as
 * unverified, so its first real status still tells the people who saved it.
 */
export function shouldNotifyStatusChange(
  previous: string | null | undefined,
  next: string,
): boolean {
  return (previous ?? "unverified") !== next;
}

/** Whether a status change is bad news, so the alert can say so plainly. */
export function isStatusDowngrade(previous: string | null, next: string): boolean {
  const rank = (status: string | null) => {
    const index = (HALAL_STATUSES as readonly string[]).indexOf(status ?? "unverified");
    return index === -1 ? HALAL_STATUSES.length : index;
  };
  // `not-halal` is last in the list but an explicit finding, not a weaker tier.
  if (next === "not-halal") return previous !== "not-halal";
  if (previous === "not-halal") return false;
  return rank(next) > rank(previous);
}

/** Keys that keep one event from notifying the same person twice. */
export const dedupeKeys = {
  like: (visitId: string, actorId: string) => `like:${visitId}:${actorId}`,
  comment: (commentId: string) => `comment:${commentId}`,
  follow: (actorId: string) => `follow:${actorId}`,
  followRequest: (actorId: string) => `follow-request:${actorId}`,
  followAccepted: (actorId: string) => `follow-accepted:${actorId}`,
  friendVisit: (visitId: string) => `friend-visit:${visitId}`,
  statusChange: (historyId: string) => `status:${historyId}`,
  checkReviewed: (verificationId: string) => `check:${verificationId}`,
  listInvite: (listId: string) => `list-invite:${listId}`,
  listPlace: (listId: string, actorId: string, placeId: string) =>
    `list-place:${listId}:${actorId}:${placeId}`,
  rec: (recId: string) => `rec:${recId}`,
  recReply: (recId: string) => `rec-reply:${recId}`,
} as const;

/** One stored notification with what is needed to word it. */
export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  createdAt: number;
  readAt: number | null;
  actor: { handle: string; displayName: string | null } | null;
  placeId: string | null;
  placeName: string | null;
  visitId: string | null;
  listId: string | null;
  listTitle: string | null;
  recId: string | null;
  /** From the status history row, for `status-changed`. */
  statusChange: {
    previous: string | null;
    next: string;
    reason: string | null;
  } | null;
  /** The reviewed check's outcome, for `check-reviewed`. */
  checkOutcome: "approved" | "rejected" | null;
};

/** A row as shown: likes on one visit and places added to one list collapse. */
export type NotificationItem = {
  id: string;
  /** Ids of every stored row folded into this item, for marking them read. */
  ids: string[];
  kind: NotificationKind;
  createdAt: number;
  unread: boolean;
  /** The main line. Parts render bold where `strong` is set. */
  parts: { text: string; strong?: boolean }[];
  detail: string | null;
  href: string;
  /** A follow-back or accept button belongs on this row. */
  actorHandle: string | null;
  downgrade: boolean;
};

function name(actor: NotificationRow["actor"]): string {
  if (!actor) return "Someone";
  return actor.displayName?.trim() || `@${actor.handle}`;
}

const strong = (text: string) => ({ text, strong: true });
const plain = (text: string) => ({ text });

function others(count: number): string {
  return count === 1 ? "1 other" : `${count} others`;
}

/**
 * Fold rows into items. A run of likes on the same visit becomes "Umar and 17
 * others liked your visit", and several places added to one list by one person
 * become one line. Everything else stays one row per event, newest first.
 */
export function groupNotifications(rows: readonly NotificationRow[]): NotificationItem[] {
  const ordered = [...rows].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const items: NotificationItem[] = [];
  const likeGroups = new Map<string, NotificationRow[]>();
  const addGroups = new Map<string, NotificationRow[]>();
  const placed = new Set<string>();

  for (const row of ordered) {
    if (row.kind === "like" && row.visitId) {
      const group = likeGroups.get(row.visitId);
      if (group) group.push(row);
      else likeGroups.set(row.visitId, [row]);
    } else if (row.kind === "list-places-added" && row.listId && row.actor) {
      const key = `${row.listId}:${row.actor.handle}`;
      const group = addGroups.get(key);
      if (group) group.push(row);
      else addGroups.set(key, [row]);
    }
  }

  for (const row of ordered) {
    if (row.kind === "like" && row.visitId) {
      if (placed.has(`like:${row.visitId}`)) continue;
      placed.add(`like:${row.visitId}`);
      items.push(describeGroup(likeGroups.get(row.visitId) ?? [row]));
    } else if (row.kind === "list-places-added" && row.listId && row.actor) {
      const key = `add:${row.listId}:${row.actor.handle}`;
      if (placed.has(key)) continue;
      placed.add(key);
      items.push(describeGroup(addGroups.get(`${row.listId}:${row.actor.handle}`) ?? [row]));
    } else {
      items.push(describeNotification(row));
    }
  }
  return items;
}

function describeGroup(group: readonly NotificationRow[]): NotificationItem {
  const [latest] = group;
  const base = describeNotification(latest);
  const ids = group.map((row) => row.id);
  const unread = group.some((row) => row.readAt === null);
  if (latest.kind === "like") {
    const actors = [...new Set(group.map((row) => name(row.actor)))];
    const rest = actors.length - 1;
    return {
      ...base,
      ids,
      unread,
      parts: [
        strong(actors[0]),
        plain(rest > 0 ? ` and ${others(rest)} liked your visit` : " liked your visit"),
        ...(latest.placeName ? [plain(" to "), strong(latest.placeName)] : []),
      ],
    };
  }
  const count = group.length;
  return {
    ...base,
    ids,
    unread,
    parts: [
      strong(name(latest.actor)),
      plain(` added ${count === 1 ? "a place" : `${count} places`} to `),
      strong(latest.listTitle ?? "your list"),
    ],
  };
}

/** The wording and destination for one stored notification. */
export function describeNotification(row: NotificationRow): NotificationItem {
  const base = {
    id: row.id,
    ids: [row.id],
    kind: row.kind,
    createdAt: row.createdAt,
    unread: row.readAt === null,
    detail: null as string | null,
    actorHandle: row.actor?.handle ?? null,
    downgrade: false,
  };
  const who = strong(name(row.actor));
  const place = strong(row.placeName ?? "a place");
  const profile = row.actor ? `/u/${row.actor.handle}` : "/activity";
  const placeHref = row.placeId ? `/place/${row.placeId}` : "/activity";

  switch (row.kind) {
    case "status-changed": {
      const next = row.statusChange?.next ?? "unverified";
      const label = STATUS_COPY[next as HalalTaxonomyStatus]?.label ?? "Unverified";
      const downgrade = isStatusDowngrade(row.statusChange?.previous ?? null, next);
      const reason = row.statusChange?.reason?.trim();
      return {
        ...base,
        parts: [place, plain(` is now “${label}”`)],
        detail: `It’s on your want-to-try.${reason ? ` ${reason}` : ""}`,
        href: row.placeId ? `/place/${row.placeId}#evidence-panel-title` : "/activity",
        downgrade,
      };
    }
    case "check-reviewed":
      return {
        ...base,
        parts:
          row.checkOutcome === "rejected"
            ? [plain("Your halal check at "), place, plain(" didn’t make it through review")]
            : [plain("Your halal check at "), place, plain(" was approved and now counts")],
        detail:
          row.checkOutcome === "rejected"
            ? "A moderator couldn’t match it to the evidence rules. You can add another check."
            : null,
        href: placeHref,
      };
    case "follow":
      return { ...base, parts: [who, plain(" followed you")], href: profile };
    case "follow-request":
      return { ...base, parts: [who, plain(" asked to follow you")], href: "/settings" };
    case "follow-accepted":
      return { ...base, parts: [who, plain(" accepted your follow request")], href: profile };
    case "like":
      return {
        ...base,
        parts: [who, plain(" liked your visit"), ...(row.placeName ? [plain(" to "), place] : [])],
        href: row.visitId ? `/visit/${row.visitId}` : "/activity",
      };
    case "comment":
      return {
        ...base,
        parts: [who, plain(" commented on your visit"), ...(row.placeName ? [plain(" to "), place] : [])],
        href: row.visitId ? `/visit/${row.visitId}` : "/activity",
      };
    case "friend-visit":
      return {
        ...base,
        parts: [who, plain(" visited "), place, plain(", which is on your want-to-try")],
        href: row.visitId ? `/visit/${row.visitId}` : placeHref,
      };
    case "list-invite":
      return {
        ...base,
        parts: [who, plain(" invited you to plan "), strong(row.listTitle ?? "a list")],
        href: row.listId ? `/list/${row.listId}` : "/lists",
      };
    case "list-places-added":
      return {
        ...base,
        parts: [who, plain(" added a place to "), strong(row.listTitle ?? "your list")],
        href: row.listId ? `/list/${row.listId}` : "/lists",
      };
    case "rec":
      return {
        ...base,
        parts: [
          who,
          plain(" sent you "),
          strong(row.placeName ?? row.listTitle ?? "a recommendation"),
        ],
        href: "/recs",
      };
    case "rec-reply":
      return {
        ...base,
        parts: [who, plain(" replied to your recommendation of "), strong(row.placeName ?? row.listTitle ?? "a place")],
        href: "/recs?box=sent",
      };
  }
}

/** The number on the bell: capped, so it never grows unbounded. */
export const UNREAD_BADGE_CAP = 99;

export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(Math.trunc(count));
}
