-- Better Auth core + database-backed rate limiting for halalfood.world.
-- Apply this file once to the existing Neon database before deploying the
-- auth routes. It is safe to re-run after the full migration has completed.

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean NOT NULL DEFAULT false,
  "image" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" ("user_id");

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("user_id");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "verification_identifier_idx"
  ON "verification" ("identifier");

-- Better Auth's built-in endpoint/IP limiter. The OTP-specific limiter below
-- is separate because it also needs hashed email keys, cooldowns, and daily
-- caps for the Resend budget.
CREATE TABLE IF NOT EXISTS "rate_limit" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "last_request" bigint NOT NULL
);

-- Application-level durable OTP budget. Keys are SHA-256 hashes prefixed by
-- scope, so raw emails and IP addresses are never stored in this table.
CREATE TABLE IF NOT EXISTS "auth_otp_rate_limit" (
  "key" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "window_count" integer NOT NULL,
  "last_action_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "auth_otp_rate_limit_updated_at_idx"
  ON "auth_otp_rate_limit" ("updated_at");
