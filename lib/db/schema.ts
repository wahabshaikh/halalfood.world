import {
  integer,
  real,
  sqliteTable,
  text,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/** Better Auth's core SQLite tables. Keep these names aligned with auth.ts. */
export const authUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const authSession = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const authAccount = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const authVerification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const authRateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request", { mode: "number" }).notNull(),
});

export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
};

/**
 * Application-level durable OTP budget. Keys are SHA-256 hashes prefixed by
 * scope, so raw emails and IP addresses are never stored in this table. Read
 * and written only through raw SQL in otp-rate-limit.ts.
 */
export const authOtpRateLimit = sqliteTable("auth_otp_rate_limit", {
  key: text("key").primaryKey(),
  windowStartedAt: integer("window_started_at", {
    mode: "timestamp_ms",
  }).notNull(),
  windowCount: integer("window_count").notNull(),
  lastActionAt: integer("last_action_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Everything below mirrors migrations/0001_baseline.sql, which is the source of
 * truth. Repositories read and write these tables through raw SQL (`db.all(sql…)`),
 * so these definitions document shape and give typed column names; indexes and
 * CHECK constraints live only in the migration.
 */

export const googleSearchDaily = sqliteTable("google_search_daily", {
  day: text("day").primaryKey(),
  callCount: integer("call_count").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

const ms = (name: string) => integer(name, { mode: "number" });
const userRef = (name: string) => text(name).references(() => authUser.id, { onDelete: "cascade" });

export const moderators = sqliteTable("moderators", {
  userId: userRef("user_id").primaryKey(),
  role: text("role", { enum: ["moderator", "admin"] }).notNull().default("moderator"),
  createdAt: ms("created_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  createdAt: ms("created_at").notNull(),
});

export const places = sqliteTable("places", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  citySlug: text("city_slug").notNull(),
  streetAddress: text("street_address").notNull(),
  addressLocality: text("address_locality"),
  addressRegion: text("address_region"),
  postalCode: text("postal_code"),
  addressCountry: text("address_country"),
  telephone: text("telephone"),
  website: text("website"),
  mapsUrl: text("maps_url"),
  googlePlaceId: text("google_place_id"),
  servesCuisine: text("serves_cuisine", { mode: "json" }).notNull().$type<string[]>(),
  lat: real("lat"),
  lng: real("lng"),
  submittedByUserId: text("submitted_by_user_id"),
  listingStatus: text("listing_status", { enum: ["listed", "hidden", "closed"] }).notNull().default("listed"),
  googleDetailsSnapshot: text("google_details_snapshot"),
  googleDetailsCachedAt: ms("google_details_cached_at"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

const factValue = (name: string) => text(name, { enum: ["yes", "no"] });

export const placeStatus = sqliteTable("place_status", {
  placeId: text("place_id").primaryKey().references(() => places.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["verified", "checking", "unchecked"] }).notNull(),
  progress: integer("progress").notNull(),
  ownedValue: factValue("owned_value"),
  ownedStreak: integer("owned_streak").notNull(),
  ownedSettled: factValue("owned_settled"),
  certifiedValue: factValue("certified_value"),
  certifiedStreak: integer("certified_streak").notNull(),
  certifiedSettled: factValue("certified_settled"),
  porkValue: factValue("pork_value"),
  porkStreak: integer("pork_streak").notNull(),
  porkSettled: factValue("pork_settled"),
  alcoholValue: factValue("alcohol_value"),
  alcoholStreak: integer("alcohol_streak").notNull(),
  alcoholSettled: factValue("alcohol_settled"),
  ownedSources: text("owned_sources").notNull().default(""),
  certifiedSources: text("certified_sources").notNull().default(""),
  porkSources: text("pork_sources").notNull().default(""),
  alcoholSources: text("alcohol_sources").notNull().default(""),
  disputedFacts: text("disputed_facts").notNull().default(""),
  listingClaim: text("listing_claim", { enum: ["only", "yes", "no"] }),
  eligibleChecks: integer("eligible_checks").notNull(),
  lastCheckedAt: ms("last_checked_at"),
  verifiedAt: ms("verified_at"),
  updatedAt: ms("updated_at").notNull(),
});

export const placeStatusChanges = sqliteTable("place_status_changes", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  fact: text("fact"),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  createdAt: ms("created_at").notNull(),
});

export const savedPlaces = sqliteTable(
  "saved_places",
  {
    userId: userRef("user_id").notNull(),
    placeId: text("place_id").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.placeId] })],
);

export const placeMediaLinks = sqliteTable("place_media_links", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull(),
  submittedByUserId: text("submitted_by_user_id"),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube"] }).notNull(),
  url: text("url").notNull(),
  authorHandle: text("author_handle"),
  authorName: text("author_name"),
  title: text("title"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: ms("created_at").notNull(),
});

const answer = (name: string) => text(name, { enum: ["yes", "no", "unsure"] });

export const checks = sqliteTable("checks", {
  id: text("id").primaryKey(),
  userId: userRef("user_id").notNull(),
  placeId: text("place_id").notNull(),
  owned: answer("owned"),
  certified: answer("certified"),
  pork: answer("pork"),
  alcohol: answer("alcohol"),
  verdict: text("verdict", { enum: ["no", "okay", "liked", "loved"] }),
  note: text("note"),
  shared: integer("shared", { mode: "boolean" }).notNull(),
  excluded: integer("excluded", { mode: "boolean" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: ms("created_at").notNull(),
});

export const checkDishes = sqliteTable(
  "check_dishes",
  {
    checkId: text("check_id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.position] })],
);

export const placePhotos = sqliteTable("place_photos", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull(),
  userId: userRef("user_id").notNull(),
  checkId: text("check_id"),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: ms("created_at").notNull(),
});

/** Evidence besides checks: reviewed certificates and menus, and map listings. */
export const placeSignals = sqliteTable("place_signals", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["certificate", "menu", "listing"] }).notNull(),
  provider: text("provider", { enum: ["osm", "geoapify"] }),
  externalId: text("external_id"),
  owned: factValue("owned"),
  certified: factValue("certified"),
  pork: factValue("pork"),
  alcohol: factValue("alcohol"),
  listingClaim: text("listing_claim", { enum: ["only", "yes", "no"] }),
  photoId: text("photo_id"),
  submittedByUserId: text("submitted_by_user_id"),
  certifier: text("certifier"),
  expiresAt: ms("expires_at"),
  reviewStatus: text("review_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reviewedByUserId: text("reviewed_by_user_id"),
  reviewedAt: ms("reviewed_at"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export const profiles = sqliteTable("profiles", {
  userId: userRef("user_id").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatarKey: text("avatar_key"),
  homeCitySlug: text("home_city_slug"),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull(),
  listsPrivateDefault: integer("lists_private_default", { mode: "boolean" }).notNull(),
  showOnLeaderboards: integer("show_on_leaderboards", { mode: "boolean" }).notNull(),
  defaultFilters: text("default_filters", { mode: "json" }).notNull().$type<string[]>(),
  onboardedAt: ms("onboarded_at"),
  invitedByUserId: text("invited_by_user_id"),
  suspendedAt: ms("suspended_at"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export const follows = sqliteTable(
  "follows",
  {
    followerId: userRef("follower_id").notNull(),
    followeeId: userRef("followee_id").notNull(),
    status: text("status", { enum: ["pending", "accepted"] }).notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.followerId, table.followeeId] })],
);

export const blocks = sqliteTable(
  "blocks",
  {
    blockerId: userRef("blocker_id").notNull(),
    blockedId: userRef("blocked_id").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] })],
);

export const likes = sqliteTable(
  "likes",
  {
    checkId: text("check_id").notNull(),
    userId: userRef("user_id").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.userId] })],
);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  checkId: text("check_id").notNull(),
  userId: userRef("user_id").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["visible", "hidden"] }).notNull(),
  createdAt: ms("created_at").notNull(),
});

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  ownerId: userRef("owner_id").notNull(),
  kind: text("kind", { enum: ["ranked", "plan", "guide"] }).notNull(),
  title: text("title").notNull(),
  caption: text("caption"),
  visibility: text("visibility", { enum: ["public", "followers", "private"] }).notNull(),
  citySlug: text("city_slug"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export const listItems = sqliteTable(
  "list_items",
  {
    listId: text("list_id").notNull(),
    placeId: text("place_id").notNull(),
    position: integer("position").notNull(),
    note: text("note"),
    addedByUserId: text("added_by_user_id"),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.listId, table.placeId] })],
);

export const listMembers = sqliteTable(
  "list_members",
  {
    listId: text("list_id").notNull(),
    userId: userRef("user_id").notNull(),
    status: text("status", { enum: ["invited", "accepted"] }).notNull(),
    invitedBy: text("invited_by"),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.listId, table.userId] })],
);

export const listSaves = sqliteTable(
  "list_saves",
  {
    listId: text("list_id").notNull(),
    userId: userRef("user_id").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.listId, table.userId] })],
);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  citySlug: text("city_slug").notNull(),
  venue: text("venue").notNull(),
  address: text("address"),
  startsAt: ms("starts_at").notNull(),
  endsAt: ms("ends_at"),
  status: text("status", { enum: ["draft", "published", "cancelled"] }).notNull(),
  createdBy: text("created_by"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export const eventVendors = sqliteTable("event_vendors", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  name: text("name").notNull(),
  note: text("note"),
  placeId: text("place_id"),
  position: integer("position").notNull(),
});

export const eventRsvps = sqliteTable(
  "event_rsvps",
  {
    eventId: text("event_id").notNull(),
    userId: userRef("user_id").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] })],
);

export const recs = sqliteTable("recs", {
  id: text("id").primaryKey(),
  senderId: userRef("sender_id").notNull(),
  recipientId: userRef("recipient_id").notNull(),
  placeId: text("place_id"),
  listId: text("list_id"),
  eventId: text("event_id"),
  note: text("note"),
  reply: text("reply", { enum: ["in", "want-to-try"] }),
  repliedAt: ms("replied_at"),
  readAt: ms("read_at"),
  createdAt: ms("created_at").notNull(),
});

export const NOTIFICATION_KINDS = [
  "status-changed",
  "follow",
  "follow-request",
  "follow-accepted",
  "like",
  "comment",
  "friend-visit",
  "list-invite",
  "rec-reply",
  "invite-joined",
] as const;

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: userRef("user_id").notNull(),
  kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
  actorId: text("actor_id"),
  placeId: text("place_id"),
  checkId: text("check_id"),
  listId: text("list_id"),
  recId: text("rec_id"),
  statusChangeId: text("status_change_id"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: ms("created_at").notNull(),
  readAt: ms("read_at"),
});

export const points = sqliteTable("points", {
  id: text("id").primaryKey(),
  userId: userRef("user_id").notNull(),
  kind: text("kind", { enum: ["check", "place-added", "helped-verify"] }).notNull(),
  placeId: text("place_id").notNull(),
  checkId: text("check_id"),
  citySlug: text("city_slug").notNull(),
  points: integer("points").notNull(),
  day: text("day").notNull(),
  createdAt: ms("created_at").notNull(),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  targetType: text("target_type", { enum: ["place", "check", "comment", "user", "list"] }).notNull(),
  targetId: text("target_id").notNull(),
  reporterId: text("reporter_id"),
  reason: text("reason").notNull(),
  detail: text("detail"),
  status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull(),
  action: text("action"),
  reviewedBy: text("reviewed_by"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});
