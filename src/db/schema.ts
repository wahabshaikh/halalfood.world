import {
  integer,
  real,
  sqliteTable,
  text,
  index,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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
 * `servesCuisine`, timestamps, and booleans below are read and written
 * exclusively through raw SQL in src/lib/*.ts, not drizzle's query builder,
 * so these column definitions document shape rather than drive (de)serialization.
 */
export const places = sqliteTable("places", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  citySlug: text("city_slug").notNull(),
  cityUrl: text("city_url").notNull(),
  listPosition: integer("list_position"),
  streetAddress: text("street_address").notNull(),
  addressLocality: text("address_locality"),
  addressRegion: text("address_region"),
  postalCode: text("postal_code"),
  addressCountry: text("address_country"),
  telephone: text("telephone"),
  website: text("website"),
  mapsUrl: text("maps_url"),
  googlePlaceId: text("google_place_id"),
  servesCuisine: text("serves_cuisine", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  ratingValue: text("rating_value"),
  reviewCount: integer("review_count"),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull(),
  scrapedAt: integer("scraped_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lat: real("lat"),
  lng: real("lng"),
  submittedByUserId: text("submitted_by_user_id"),
  halalConfirmed: integer("halal_confirmed", { mode: "boolean" })
    .notNull()
    .default(true),
  googleDetailsCachedAt: integer("google_details_cached_at", {
    mode: "timestamp_ms",
  }),
  googleDetailsSnapshot: text("google_details_snapshot"),
  /** Full legacy Place Details `result` JSON, retained for backfill provenance. */
  googlePlacePayload: text("google_place_payload"),
  /** Unix epoch milliseconds when the legacy Place Details payload was fetched. */
  googlePlaceFetchedAt: integer("google_place_fetched_at", {
    mode: "timestamp_ms",
  }),
});

export const savedPlaces = sqliteTable(
  "saved_places",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "saved_places_pkey",
      columns: [table.userId, table.placeId],
    }),
    index("saved_places_user_id_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("saved_places_place_id_idx").on(table.placeId),
  ],
);

export const placeRatings = sqliteTable(
  "place_ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    rating: text("rating", {
      enum: ["mashallah", "alhamdulillah", "astaghfirullah"],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "place_ratings_pkey",
      columns: [table.userId, table.placeId],
    }),
    check(
      "place_ratings_rating_check",
      sql`${table.rating} IN ('mashallah', 'alhamdulillah', 'astaghfirullah')`,
    ),
    index("place_ratings_place_id_rating_idx").on(table.placeId, table.rating),
  ],
);

export const placeReviews = sqliteTable(
  "place_reviews",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    title: text("title"),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "place_reviews_pkey",
      columns: [table.userId, table.placeId],
    }),
    check(
      "place_reviews_body_check",
      sql`length(trim(${table.body})) > 0 AND length(${table.body}) <= 5000`,
    ),
    check(
      "place_reviews_title_check",
      sql`${table.title} IS NULL OR length(${table.title}) <= 120`,
    ),
    index("place_reviews_place_id_created_at_idx").on(
      table.placeId,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

export const placePhotos = sqliteTable(
  "place_photos",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    originalFileName: text("original_file_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check(
      "place_photos_content_type_check",
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "place_photos_byte_size_check",
      sql`${table.byteSize} BETWEEN 1 AND 8388608`,
    ),
    index("place_photos_place_id_created_at_idx").on(
      table.placeId,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

export const placeHalalVerifications = sqliteTable(
  "place_halal_verifications",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("place_halal_verifications_place_status_created_idx").on(
      table.placeId,
      table.status,
      table.createdAt,
    ),
    index("place_halal_verifications_submitter_idx").on(
      table.submittedByUserId,
      table.createdAt,
    ),
  ],
);

export const placeHalalVerificationEvidence = sqliteTable(
  "place_halal_verification_evidence",
  {
    id: text("id").primaryKey(),
    verificationId: text("verification_id")
      .notNull()
      .references(() => placeHalalVerifications.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    url: text("url"),
    r2Key: text("r2_key"),
    contentType: text("content_type"),
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("place_halal_verification_evidence_verification_idx").on(
      table.verificationId,
      table.createdAt,
    ),
    index("place_halal_verification_evidence_r2_key_idx").on(table.r2Key),
  ],
);
