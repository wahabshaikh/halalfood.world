import { sql } from "drizzle-orm";
import { database } from "../db";

export const OTP_RATE_LIMITS = {
  requestEmail: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 5,
    cooldownMs: 60 * 1000,
  },
  requestIp: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 30,
    cooldownMs: 10 * 1000,
  },
  verifyEmail: {
    windowMs: 15 * 60 * 1000,
    maxCount: 5,
    cooldownMs: 0,
  },
  verifyIp: {
    windowMs: 15 * 60 * 1000,
    maxCount: 20,
    cooldownMs: 0,
  },
} as const;

/** Durable budgets for user-submitted places, verifications, and Google searches. */
export const PLACE_RATE_LIMITS = {
  submissionUser: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 5,
    cooldownMs: 60 * 1000,
  },
  submissionIp: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 30,
    cooldownMs: 10 * 1000,
  },
  googleSearchUser: {
    windowMs: 60 * 60 * 1000,
    maxCount: 30,
    cooldownMs: 1 * 1000,
  },
  googleSearchIp: {
    windowMs: 60 * 60 * 1000,
    maxCount: 120,
    cooldownMs: 250,
  },
} as const;

/** Durable budgets for community halal verification submissions. */
export const HALAL_VERIFICATION_RATE_LIMITS = {
  submissionUser: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 5,
    cooldownMs: 60 * 1000,
  },
  submissionIp: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 30,
    cooldownMs: 10 * 1000,
  },
  uploadUser: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 20,
    cooldownMs: 0,
  },
  uploadIp: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 60,
    cooldownMs: 0,
  },
} as const;

/** Durable budgets for save/unsave mutations. */
export const SAVE_RATE_LIMITS = {
  mutationUser: {
    windowMs: 60 * 60 * 1000,
    maxCount: 120,
    cooldownMs: 250,
  },
  mutationIp: {
    windowMs: 60 * 60 * 1000,
    maxCount: 300,
    cooldownMs: 100,
  },
} as const;

/** Durable budgets for halal place rating mutations. */
export const RATING_RATE_LIMITS = {
  mutationUser: {
    windowMs: 60 * 60 * 1000,
    maxCount: 120,
    cooldownMs: 250,
  },
  mutationIp: {
    windowMs: 60 * 60 * 1000,
    maxCount: 300,
    cooldownMs: 100,
  },
} as const;

/** Descriptive alias for callers that group limits by feature. */
export const PLACE_RATING_RATE_LIMITS = RATING_RATE_LIMITS;

/** Durable budgets for halal place review mutations. */
export const REVIEW_RATE_LIMITS = {
  mutationUser: {
    windowMs: 60 * 60 * 1000,
    maxCount: 120,
    cooldownMs: 250,
  },
  mutationIp: {
    windowMs: 60 * 60 * 1000,
    maxCount: 300,
    cooldownMs: 100,
  },
} as const;

/** Descriptive alias for callers that group limits by feature. */
export const PLACE_REVIEW_RATE_LIMITS = REVIEW_RATE_LIMITS;

/** Durable budgets for linking creator videos to places (each one fetches oEmbed). */
export const MEDIA_LINK_RATE_LIMITS = {
  submissionUser: {
    windowMs: 60 * 60 * 1000,
    maxCount: 30,
    cooldownMs: 1000,
  },
  submissionIp: {
    windowMs: 60 * 60 * 1000,
    maxCount: 90,
    cooldownMs: 250,
  },
} as const;

/** Durable budgets for place photo uploads and ownership mutations. */
export const PLACE_PHOTO_RATE_LIMITS = {
  uploadUser: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 20,
    cooldownMs: 0,
  },
  uploadIp: {
    windowMs: 24 * 60 * 60 * 1000,
    maxCount: 60,
    cooldownMs: 0,
  },
  mutationUser: {
    windowMs: 60 * 60 * 1000,
    maxCount: 120,
    cooldownMs: 250,
  },
  mutationIp: {
    windowMs: 60 * 60 * 1000,
    maxCount: 300,
    cooldownMs: 100,
  },
} as const;

/** Descriptive alias for callers that use the shorter feature name. */
export const PHOTO_RATE_LIMITS = PLACE_PHOTO_RATE_LIMITS;

export type OtpRateLimitRule = {
  windowMs: number;
  maxCount: number;
  cooldownMs: number;
};

export type OtpRateLimitState = {
  windowStartedAt: number | null;
  count: number;
  lastActionAt: number | null;
};

export type OtpRateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
  next: OtpRateLimitState;
};

/** Pure policy helper used by the database implementation and unit tests. */
export function evaluateOtpRateLimit(
  state: OtpRateLimitState,
  rule: OtpRateLimitRule,
  now: number,
): OtpRateLimitDecision {
  const windowExpired =
    state.windowStartedAt === null ||
    now - state.windowStartedAt >= rule.windowMs;
  const cooldownExpired =
    state.lastActionAt === null || now - state.lastActionAt >= rule.cooldownMs;
  const allowed =
    windowExpired || (state.count < rule.maxCount && cooldownExpired);

  if (allowed) {
    return {
      allowed: true,
      retryAfterMs: 0,
      next: {
        windowStartedAt: windowExpired ? now : state.windowStartedAt,
        count: windowExpired ? 1 : state.count + 1,
        lastActionAt: now,
      },
    };
  }

  const retryAfterMs =
    state.count >= rule.maxCount
      ? Math.max(
          state.windowStartedAt === null
            ? 0
            : state.windowStartedAt + rule.windowMs - now,
          0,
        )
      : Math.max(
          state.lastActionAt === null
            ? 0
            : state.lastActionAt + rule.cooldownMs - now,
          0,
        );
  return { allowed: false, retryAfterMs, next: state };
}

/** Better Auth lowercases email addresses before creating its OTP identifier. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    return null;
  return email;
}

/** Cloudflare supplies this header at the Worker edge. */
export function getClientIp(request: Request): string {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp.slice(0, 128);

  // Local tests/dev servers do not have Cloudflare's trusted header. Do not
  // trust forwarded headers in production, where a Worker should have CF IP.
  if (process.env.NODE_ENV !== "production") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 128);
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp.slice(0, 128);
  }
  return "unknown";
}

async function identifierKey(scope: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${scope}:${hash}`;
}

export type RateLimitBucket = {
  key: string;
  rule: OtpRateLimitRule;
};

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export interface OtpRateLimitStore {
  consume(
    buckets: readonly [RateLimitBucket, RateLimitBucket],
    now: Date,
  ): Promise<Pick<OtpRateLimitDecision, "allowed" | "retryAfterMs">>;
}

type StoredOtpRateLimitRow = {
  window_started_at: number;
  window_count: number;
  last_action_at: number;
};

/**
 * D1 rejects SQL `BEGIN` (error 7500), so this does not use `db.transaction()`.
 * The database is one Durable Object, so statements already run one at a time.
 * The decision is computed from a read and only written if every bucket allows
 * it.
 */
export function d1OtpRateLimitStore(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): OtpRateLimitStore {
  return {
    async consume(buckets, now) {
      const db = await client;
      const nowMs = now.getTime();
      const states = await Promise.all(
          buckets.map(async (bucket) => {
            const rows = await db.all<StoredOtpRateLimitRow>(sql`
              SELECT window_started_at, window_count, last_action_at
              FROM auth_otp_rate_limit
              WHERE key = ${bucket.key}
            `);
            const row = rows[0];
            const state: OtpRateLimitState = row
              ? {
                  windowStartedAt: row.window_started_at,
                  count: row.window_count,
                  lastActionAt: row.last_action_at,
                }
              : { windowStartedAt: null, count: 0, lastActionAt: null };
            return { bucket, decision: evaluateOtpRateLimit(state, bucket.rule, nowMs) };
          }),
        );

        const allowed = states.every(({ decision }) => decision.allowed);
        const retryAfterMs = allowed
          ? 0
          : Math.max(
              0,
              ...states.map(({ decision }) => (decision.allowed ? 0 : decision.retryAfterMs)),
            );

        if (allowed) {
          await Promise.all(
            states.map(({ bucket, decision }) =>
              db.run(sql`
                INSERT INTO auth_otp_rate_limit (
                  key, window_started_at, window_count, last_action_at, updated_at
                ) VALUES (
                  ${bucket.key}, ${decision.next.windowStartedAt}, ${decision.next.count},
                  ${decision.next.lastActionAt}, ${nowMs}
                )
                ON CONFLICT (key) DO UPDATE SET
                  window_started_at = excluded.window_started_at,
                  window_count = excluded.window_count,
                  last_action_at = excluded.last_action_at,
                  updated_at = excluded.updated_at
              `),
            ),
          );
        }

        return { allowed, retryAfterMs };
    },
  };
}

async function consumePair(
  buckets: readonly [RateLimitBucket, RateLimitBucket],
  store: OtpRateLimitStore,
  now = new Date(),
) {
  return store.consume(buckets, now);
}

export async function consumeOtpRequestLimits(
  email: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [emailKey, ipKey] = await Promise.all([
    identifierKey("request:email", email),
    identifierKey("request:ip", ip),
  ]);
  return consumePair(
    [
      { key: emailKey, rule: OTP_RATE_LIMITS.requestEmail },
      { key: ipKey, rule: OTP_RATE_LIMITS.requestIp },
    ],
    store,
    now,
  );
}

export async function consumeOtpVerificationLimits(
  email: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [emailKey, ipKey] = await Promise.all([
    identifierKey("verify:email", email),
    identifierKey("verify:ip", ip),
  ]);
  return consumePair(
    [
      { key: emailKey, rule: OTP_RATE_LIMITS.verifyEmail },
      { key: ipKey, rule: OTP_RATE_LIMITS.verifyIp },
    ],
    store,
    now,
  );
}

export async function consumePlaceSubmissionLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("place:submit:user", userId),
    identifierKey("place:submit:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: PLACE_RATE_LIMITS.submissionUser },
      { key: ipKey, rule: PLACE_RATE_LIMITS.submissionIp },
    ],
    store,
    now,
  );
}

export async function consumeGooglePlaceSearchLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("place:google-search:user", userId),
    identifierKey("place:google-search:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: PLACE_RATE_LIMITS.googleSearchUser },
      { key: ipKey, rule: PLACE_RATE_LIMITS.googleSearchIp },
    ],
    store,
    now,
  );
}

export async function consumeSavePlaceLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("saved-place:mutate:user", userId),
    identifierKey("saved-place:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: SAVE_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: SAVE_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}

export async function consumePlaceRatingLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("place-rating:mutate:user", userId),
    identifierKey("place-rating:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: RATING_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: RATING_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}

export async function consumePlaceReviewLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("place-review:mutate:user", userId),
    identifierKey("place-review:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: REVIEW_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: REVIEW_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}

export async function consumePlacePhotoUploadLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("place-photo:upload:user", userId),
    identifierKey("place-photo:upload:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: PLACE_PHOTO_RATE_LIMITS.uploadUser },
      { key: ipKey, rule: PLACE_PHOTO_RATE_LIMITS.uploadIp },
    ],
    store,
    now,
  );
}

export async function consumePlacePhotoMutationLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("place-photo:mutate:user", userId),
    identifierKey("place-photo:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: PLACE_PHOTO_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: PLACE_PHOTO_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}

export async function consumeHalalVerificationLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("halal-verification:submit:user", userId),
    identifierKey("halal-verification:submit:ip", ip),
  ]);
  return consumePair(
    [
      {
        key: userKey,
        rule: HALAL_VERIFICATION_RATE_LIMITS.submissionUser,
      },
      { key: ipKey, rule: HALAL_VERIFICATION_RATE_LIMITS.submissionIp },
    ],
    store,
    now,
  );
}

export async function consumeHalalVerificationUploadLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("halal-verification:upload:user", userId),
    identifierKey("halal-verification:upload:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: HALAL_VERIFICATION_RATE_LIMITS.uploadUser },
      { key: ipKey, rule: HALAL_VERIFICATION_RATE_LIMITS.uploadIp },
    ],
    store,
    now,
  );
}

export async function consumeMediaLinkLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("media-link:submit:user", userId),
    identifierKey("media-link:submit:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: MEDIA_LINK_RATE_LIMITS.submissionUser },
      { key: ipKey, rule: MEDIA_LINK_RATE_LIMITS.submissionIp },
    ],
    store,
    now,
  );
}

export function retryAfterSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

/* ------------------------------------------------ trust-platform budgets -- */

/** A check-in is cheap to write but easy to farm, so the daily cap is low. */
export const CHECK_IN_RATE_LIMITS = {
  mutationUser: { windowMs: 24 * 60 * 60 * 1000, maxCount: 40, cooldownMs: 2000 },
  mutationIp: { windowMs: 24 * 60 * 60 * 1000, maxCount: 200, cooldownMs: 500 },
} as const;

/** Lists, preferences and other low-risk personal writes. */
export const PERSONAL_RATE_LIMITS = {
  mutationUser: { windowMs: 60 * 60 * 1000, maxCount: 120, cooldownMs: 250 },
  mutationIp: { windowMs: 60 * 60 * 1000, maxCount: 300, cooldownMs: 100 },
} as const;

/** Community contributions: edits, dishes, duplicate reports, abuse reports. */
export const CONTRIBUTION_RATE_LIMITS = {
  mutationUser: { windowMs: 24 * 60 * 60 * 1000, maxCount: 60, cooldownMs: 1000 },
  mutationIp: { windowMs: 24 * 60 * 60 * 1000, maxCount: 200, cooldownMs: 500 },
} as const;

export async function consumeCheckInLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("check-in:mutate:user", userId),
    identifierKey("check-in:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: CHECK_IN_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: CHECK_IN_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}

export async function consumePersonalWriteLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("personal:mutate:user", userId),
    identifierKey("personal:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: PERSONAL_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: PERSONAL_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}

export async function consumeContributionLimits(
  userId: string,
  ip: string,
  store: OtpRateLimitStore = d1OtpRateLimitStore(),
  now = new Date(),
) {
  const [userKey, ipKey] = await Promise.all([
    identifierKey("contribution:mutate:user", userId),
    identifierKey("contribution:mutate:ip", ip),
  ]);
  return consumePair(
    [
      { key: userKey, rule: CONTRIBUTION_RATE_LIMITS.mutationUser },
      { key: ipKey, rule: CONTRIBUTION_RATE_LIMITS.mutationIp },
    ],
    store,
    now,
  );
}
