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

/* ---------------------------------------------------------------------------
 * Trust-first platform tables (migration 0008). As above, these definitions
 * document the shape; reads and writes go through raw SQL in src/lib/*.ts.
 * ------------------------------------------------------------------------ */

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  minimumStatus: text("minimum_status").notNull().default("self-declared"),
  requireCertification: integer("require_certification", { mode: "boolean" })
    .notNull()
    .default(false),
  avoidAlcohol: integer("avoid_alcohol", { mode: "boolean" })
    .notNull()
    .default(false),
  avoidPork: integer("avoid_pork", { mode: "boolean" }).notNull().default(false),
  requireDedicatedKitchen: integer("require_dedicated_kitchen", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  requirePrayerSpace: integer("require_prayer_space", { mode: "boolean" })
    .notNull()
    .default(false),
  vegetarianOnly: integer("vegetarian_only", { mode: "boolean" })
    .notNull()
    .default(false),
  maxEvidenceAgeDays: integer("max_evidence_age_days"),
  allergies: text("allergies", { mode: "json" }).notNull().$type<string[]>(),
  cuisines: text("cuisines", { mode: "json" }).notNull().$type<string[]>(),
  homeCitySlug: text("home_city_slug"),
  visibilityVisits: text("visibility_visits").notNull().default("public"),
  visibilityLists: text("visibility_lists").notNull().default("public"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  displayName: text("display_name"),
  bio: text("bio"),
  homeCitySlug: text("home_city_slug"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const placeFacts = sqliteTable("place_facts", {
  placeId: text("place_id")
    .primaryKey()
    .references(() => places.id, { onDelete: "cascade" }),
  servesAlcohol: text("serves_alcohol").notNull().default("unknown"),
  servesPork: text("serves_pork").notNull().default("unknown"),
  dedicatedHalalKitchen: text("dedicated_halal_kitchen")
    .notNull()
    .default("unknown"),
  muslimOwned: text("muslim_owned").notNull().default("unknown"),
  prayerSpace: text("prayer_space").notNull().default("unknown"),
  womenFriendlyFacilities: text("women_friendly_facilities")
    .notNull()
    .default("unknown"),
  vegetarianOptions: text("vegetarian_options").notNull().default("unknown"),
  certificationBody: text("certification_body"),
  priceBand: integer("price_band"),
  serviceTypes: text("service_types", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  meals: text("meals", { mode: "json" }).notNull().$type<string[]>(),
  neighbourhood: text("neighbourhood"),
  brandSlug: text("brand_slug"),
  branchLabel: text("branch_label"),
  reservationUrl: text("reservation_url"),
  deliveryUrl: text("delivery_url"),
  menuUrl: text("menu_url"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  updatedByUserId: text("updated_by_user_id"),
});

export const placeHalalStatusHistory = sqliteTable(
  "place_halal_status_history",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status").notNull(),
    previousConfidence: text("previous_confidence"),
    nextConfidence: text("next_confidence").notNull(),
    verificationId: text("verification_id"),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("place_halal_status_history_place_idx").on(
      table.placeId,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

export const placeDishes = sqliteTable(
  "place_dishes",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    cuisine: text("cuisine"),
    priceMinor: integer("price_minor"),
    currency: text("currency"),
    halalScope: text("halal_scope").notNull().default("unknown"),
    sourceUrl: text("source_url"),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
    submittedByUserId: text("submitted_by_user_id"),
    status: text("status").notNull().default("accepted"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("place_dishes_normalized_idx").on(table.normalizedName)],
);

export const placeVisits = sqliteTable(
  "place_visits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    visitedAt: integer("visited_at", { mode: "timestamp_ms" }).notNull(),
    verificationMethod: text("verification_method").notNull().default("none"),
    verificationConfidence: text("verification_confidence")
      .notNull()
      .default("none"),
    verificationDetail: text("verification_detail"),
    receiptR2Key: text("receipt_r2_key"),
    context: text("context", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    visibility: text("visibility").notNull().default("public"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("place_visits_place_idx").on(table.placeId, sql`${table.visitedAt} DESC`),
    index("place_visits_user_idx").on(table.userId, sql`${table.visitedAt} DESC`),
  ],
);

export const placeCheckIns = sqliteTable(
  "place_check_ins",
  {
    visitId: text("visit_id")
      .primaryKey()
      .references(() => placeVisits.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    wouldReturn: text("would_return", {
      enum: ["definitely", "maybe", "no"],
    }).notNull(),
    wouldBringFriend: text("would_bring_friend", {
      enum: ["yes", "maybe", "no"],
    }),
    valueVerdict: text("value_verdict", {
      enum: ["great", "fair", "overpriced"],
    }).notNull(),
    spendMinor: integer("spend_minor"),
    currency: text("currency"),
    note: text("note"),
    incentivized: integer("incentivized", { mode: "boolean" })
      .notNull()
      .default(false),
    relationship: text("relationship").notNull().default("none"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("place_check_ins_place_idx").on(
      table.placeId,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

export const placeCheckInDishes = sqliteTable(
  "place_check_in_dishes",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id")
      .notNull()
      .references(() => placeVisits.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    dishId: text("dish_id"),
    dishName: text("dish_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    verdict: text("verdict", {
      enum: ["order-again", "fine", "avoid"],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("place_check_in_dishes_place_idx").on(
      table.placeId,
      table.normalizedName,
    ),
  ],
);

export const placeLists = sqliteTable(
  "place_lists",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    ranked: integer("ranked", { mode: "boolean" }).notNull().default(true),
    visibility: text("visibility", {
      enum: ["public", "unlisted", "private"],
    })
      .notNull()
      .default("public"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("place_lists_user_slug_idx").on(table.userId, table.slug)],
);

export const placeListItems = sqliteTable(
  "place_list_items",
  {
    listId: text("list_id")
      .notNull()
      .references(() => placeLists.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "place_list_items_pkey",
      columns: [table.listId, table.placeId],
    }),
    index("place_list_items_order_idx").on(table.listId, table.position),
  ],
);

export const placeEditSuggestions = sqliteTable(
  "place_edit_suggestions",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    currentValue: text("current_value"),
    proposedValue: text("proposed_value").notNull(),
    sourceUrl: text("source_url"),
    note: text("note"),
    relationship: text("relationship").notNull().default("none"),
    status: text("status").notNull().default("pending"),
    statusReason: text("status_reason"),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("place_edit_suggestions_place_idx").on(
      table.placeId,
      table.status,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

export const placeDuplicateReports = sqliteTable(
  "place_duplicate_reports",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    duplicateOfPlaceId: text("duplicate_of_place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    statusReason: text("status_reason"),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("place_duplicate_reports_status_idx").on(table.status, table.createdAt),
  ],
);

export const moderators = sqliteTable("moderators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["moderator", "admin"] })
    .notNull()
    .default("moderator"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const contentReports = sqliteTable(
  "content_reports",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reportedByUserId: text("reported_by_user_id"),
    reason: text("reason").notNull(),
    detail: text("detail"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("content_reports_status_idx").on(table.status, table.createdAt),
    index("content_reports_target_idx").on(table.targetType, table.targetId),
  ],
);

export const reportAppeals = sqliteTable(
  "report_appeals",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => contentReports.id, { onDelete: "cascade" }),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    outcome: text("outcome"),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("report_appeals_report_idx").on(table.reportId, table.createdAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    source: text("source"),
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("audit_log_target_idx").on(
      table.targetType,
      table.targetId,
      sql`${table.createdAt} DESC`,
    ),
  ],
);
