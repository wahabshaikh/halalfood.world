-- Better Auth core + database-backed rate limiting for halalfood.world.
-- D1/SQLite dialect. Apply with `wrangler d1 migrations apply`.

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" integer NOT NULL DEFAULT 0,
  "image" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" integer NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
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
  "access_token_expires_at" integer,
  "refresh_token_expires_at" integer,
  "scope" text,
  "password" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("user_id");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
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
  "last_request" integer NOT NULL
);

-- Application-level durable OTP budget. Keys are SHA-256 hashes prefixed by
-- scope, so raw emails and IP addresses are never stored in this table.
-- Timestamps are Unix epoch milliseconds.
CREATE TABLE IF NOT EXISTS "auth_otp_rate_limit" (
  "key" text PRIMARY KEY NOT NULL,
  "window_started_at" integer NOT NULL,
  "window_count" integer NOT NULL,
  "last_action_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_otp_rate_limit_updated_at_idx"
  ON "auth_otp_rate_limit" ("updated_at");
