import { neonSql } from "../db";

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

type NeonRateLimitClient = ReturnType<typeof neonSql>;

export interface OtpRateLimitStore {
  consume(
    buckets: readonly [RateLimitBucket, RateLimitBucket],
    now: Date,
  ): Promise<Pick<OtpRateLimitDecision, "allowed" | "retryAfterMs">>;
}

/**
 * Neon HTTP supports a non-interactive transaction. Advisory locks serialize
 * the two keyed rows before the conditional upsert, so concurrent requests
 * cannot all pass a stale read and spend the same email/IP budget.
 */
export function neonOtpRateLimitStore(
  client: NeonRateLimitClient = neonSql(),
): OtpRateLimitStore {
  return {
    async consume(buckets, now) {
      const first = buckets[0];
      const second = buckets[1];
      const nowIso = now.toISOString();
      const results = await client.transaction((txn) => [
        txn`
          SELECT
            pg_advisory_xact_lock(hashtextextended(${first.key}, 0)),
            pg_advisory_xact_lock(hashtextextended(${second.key}, 0))
        `,
        txn`
          WITH input(key, window_ms, max_count, cooldown_ms) AS (
            VALUES
              (${first.key}, ${first.rule.windowMs}, ${first.rule.maxCount}, ${first.rule.cooldownMs}),
              (${second.key}, ${second.rule.windowMs}, ${second.rule.maxCount}, ${second.rule.cooldownMs})
          ),
          current_state AS (
            SELECT
              input.*,
              limits.window_started_at,
              limits.window_count,
              limits.last_action_at
            FROM input
            LEFT JOIN auth_otp_rate_limit AS limits ON limits.key = input.key
          ),
          state AS (
            SELECT
              current_state.*,
              (
                window_started_at IS NULL
                OR ${nowIso}::timestamptz >= window_started_at + window_ms * interval '1 millisecond'
                OR (
                  window_count < max_count
                  AND ${nowIso}::timestamptz >= last_action_at + cooldown_ms * interval '1 millisecond'
                )
              ) AS allowed
            FROM current_state
          ),
          decision AS (
            SELECT
              bool_and(allowed) AS allowed,
              COALESCE(
                MAX(
                  CASE
                    WHEN allowed OR window_started_at IS NULL THEN 0
                    WHEN ${nowIso}::timestamptz >= window_started_at + window_ms * interval '1 millisecond' THEN 0
                    WHEN window_count >= max_count THEN CEIL(EXTRACT(EPOCH FROM (window_started_at + window_ms * interval '1 millisecond' - ${nowIso}::timestamptz)) * 1000)
                    WHEN ${nowIso}::timestamptz < last_action_at + cooldown_ms * interval '1 millisecond' THEN CEIL(EXTRACT(EPOCH FROM (last_action_at + cooldown_ms * interval '1 millisecond' - ${nowIso}::timestamptz)) * 1000)
                    ELSE 0
                  END
                ),
                0
              )::bigint AS retry_after_ms
            FROM state
          ),
          upsert AS (
            INSERT INTO auth_otp_rate_limit (
              key,
              window_started_at,
              window_count,
              last_action_at,
              updated_at
            )
            SELECT
              key,
              CASE
                WHEN window_started_at IS NULL
                  OR ${nowIso}::timestamptz >= window_started_at + window_ms * interval '1 millisecond'
                THEN ${nowIso}::timestamptz
                ELSE window_started_at
              END,
              CASE
                WHEN window_started_at IS NULL
                  OR ${nowIso}::timestamptz >= window_started_at + window_ms * interval '1 millisecond'
                THEN 1
                ELSE window_count + 1
              END,
              ${nowIso}::timestamptz,
              ${nowIso}::timestamptz
            FROM state
            CROSS JOIN decision
            WHERE decision.allowed
            ON CONFLICT (key) DO UPDATE SET
              window_started_at = EXCLUDED.window_started_at,
              window_count = EXCLUDED.window_count,
              last_action_at = EXCLUDED.last_action_at,
              updated_at = EXCLUDED.updated_at
            RETURNING key
          )
          SELECT decision.allowed, decision.retry_after_ms
          FROM decision
          CROSS JOIN (SELECT count(*) AS applied FROM upsert) AS applied
        `,
      ]);
      const row = (
        results[1] as Array<{
          allowed?: unknown;
          retry_after_ms?: unknown;
        }>
      )[0];
      if (!row) throw new Error("Rate-limit decision was empty");
      return {
        allowed: row.allowed === true || row.allowed === "true",
        retryAfterMs: Math.max(0, Number(row.retry_after_ms) || 0),
      };
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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
  store: OtpRateLimitStore = neonOtpRateLimitStore(),
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

export function retryAfterSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}
