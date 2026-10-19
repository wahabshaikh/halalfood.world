-- Member API keys for the member MCP (docs/community-roadmap.md §3, §7). Additive only.
--
-- The key itself is shown once at creation and never stored: key_hash is its SHA-256 (hex), looked up by
-- equality so verification never compares secrets byte by byte. prefix is the key's first 8 characters,
-- shown in the list so a member can tell keys apart. scopes is 'read' or 'read,write'.
-- Revoking sets revoked_at; a revoked key never verifies again. Deleting the account deletes its keys.

CREATE TABLE IF NOT EXISTS "member_api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL CHECK (length("name") <= 40),
  "prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" text NOT NULL,
  "last_used_at" integer,
  "created_at" integer NOT NULL,
  "revoked_at" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_api_keys_hash_idx" ON "member_api_keys" ("key_hash");
CREATE INDEX IF NOT EXISTS "member_api_keys_user_idx" ON "member_api_keys" ("user_id", "created_at" DESC);
