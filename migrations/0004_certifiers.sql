-- Halal certifiers directory (docs/spec/certifiers.md). Additive: new tables only.
--
-- An authority (BPJPH for Indonesia, later JAKIM, MOIAT, GAC) publishes a list of the foreign halal
-- certification bodies it accepts. A certifier is one such body. A recognition is one certifier on one
-- authority's list, with the scopes and dates the list gives. A source is a URL we check, and each check is a
-- snapshot (raw pages in R2), and comparing snapshots gives change events.
--
-- Status only ever comes from the official source. "Expired" is computed when a page renders, from the
-- list's own valid_until date. Timestamps are epoch milliseconds, and dates the source gives are ISO text.

CREATE TABLE "cert_authority" (
  "id" text PRIMARY KEY NOT NULL,            -- 'bpjph', 'jakim', 'moiat', 'gac'
  "name" text NOT NULL,                      -- full official name
  "short_name" text NOT NULL,                -- 'BPJPH'
  "country_codes" text NOT NULL,             -- JSON array of ISO codes: ["ID"], or the GCC members for GAC
  "website" text,
  "notes_md" text,                           -- plain-language rules for exporters
  "updated_at" integer NOT NULL
);

CREATE TABLE "certifier" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,                      -- the name as the official list writes it, trimmed
  "country_code" text,                       -- ISO code of where the body is based; null when unmapped
  "city" text,
  "address" text,
  "website" text,                            -- only from an official source or the body itself, never guessed
  "email" text,
  "logo_r2_key" text,
  "claimed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "featured_until" integer,                  -- paid placement, display only; never affects status
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL              -- last real change to this body's data, the sitemap lastmod
);
CREATE INDEX "certifier_country_idx" ON "certifier" ("country_code");

-- Name variants seen in sources, normalised (lib/certifiers/names.ts), for matching across snapshots.
CREATE TABLE "certifier_alias" (
  "certifier_id" text NOT NULL REFERENCES "certifier"("id"),
  "alias_norm" text NOT NULL,
  "authority_id" text NOT NULL,              -- where we saw it
  PRIMARY KEY ("alias_norm", "authority_id")
);
CREATE INDEX "certifier_alias_certifier_idx" ON "certifier_alias" ("certifier_id");

-- A renamed body keeps its old URLs: /certifiers/<old_slug> 308s to the current slug.
CREATE TABLE "certifier_slug_history" (
  "old_slug" text PRIMARY KEY NOT NULL,
  "certifier_id" text NOT NULL REFERENCES "certifier"("id"),
  "created_at" integer NOT NULL
);

CREATE TABLE "cert_source" (
  "id" text PRIMARY KEY NOT NULL,
  "authority_id" text NOT NULL REFERENCES "cert_authority"("id"),
  "url" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('html_table', 'pdf', 'json', 'manual')),
  "parser" text NOT NULL,                    -- which parser reads it, e.g. 'bpjph_lhln'
  "active" integer NOT NULL DEFAULT 1,
  "last_checked_at" integer,                 -- last fetch attempt that reached the site
  "last_ok_at" integer,                      -- last check that fetched and parsed the whole list
  "last_error" text,
  "needs_look" integer NOT NULL DEFAULT 0    -- 1 when the safety rule held back removals or a parse failed
);

-- One row per certifier x authority: one cell of the big table.
CREATE TABLE "recognition" (
  "id" text PRIMARY KEY NOT NULL,
  "certifier_id" text NOT NULL REFERENCES "certifier"("id"),
  "authority_id" text NOT NULL REFERENCES "cert_authority"("id"),
  "status" text NOT NULL CHECK ("status" IN ('recognised', 'expired', 'suspended', 'removed', 'pending')),
  "scopes" text NOT NULL,                    -- JSON array of our scope codes (lib/certifiers/scopes.ts)
  "scopes_raw" text,                         -- scope text exactly as the source writes it
  "source_ref" text,                         -- registration number on the source, if any
  "source_key" text,                         -- the source's own id for the row (BPJPH lph_id), stable across renames
  "source_status" text,                      -- the source's own status word, as written (BPJPH: 'MRA')
  "valid_from" text,                         -- ISO date
  "valid_until" text,                        -- ISO date, e.g. '2030-06-30'; null when the source gives none
  "first_seen_at" integer NOT NULL,
  "last_seen_at" integer NOT NULL,           -- last time it was present on the source
  "last_checked_at" integer NOT NULL,        -- last time the source was checked
  "updated_at" integer NOT NULL,             -- last real change to this row's data
  "source_id" text NOT NULL REFERENCES "cert_source"("id"),
  UNIQUE ("certifier_id", "authority_id")
);
CREATE INDEX "recognition_authority_idx" ON "recognition" ("authority_id", "status");
CREATE INDEX "recognition_source_key_idx" ON "recognition" ("source_id", "source_key");

-- Scope vocabulary, and each authority's wording mapped to it.
CREATE TABLE "scope" (
  "code" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL
);
CREATE TABLE "scope_map" (
  "authority_id" text NOT NULL,
  "raw" text NOT NULL,
  "scope_code" text NOT NULL REFERENCES "scope"("code"),
  PRIMARY KEY ("authority_id", "raw")
);

CREATE TABLE "cert_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES "cert_source"("id"),
  "fetched_at" integer NOT NULL,
  "http_status" integer,
  "content_hash" text NOT NULL,              -- SHA-256 of the parsed rows in a stable form; unchanged -> no diff
  "r2_key" text NOT NULL,                    -- where the raw pages are kept (a prefix for paged sources)
  "row_count" integer,
  "parse_ok" integer NOT NULL,
  "error" text
);
CREATE INDEX "cert_snapshot_source_idx" ON "cert_snapshot" ("source_id", "fetched_at");

CREATE TABLE "cert_change" (
  "id" text PRIMARY KEY NOT NULL,
  "recognition_id" text,                     -- null until an added body is approved
  "certifier_id" text NOT NULL REFERENCES "certifier"("id"),
  "authority_id" text NOT NULL REFERENCES "cert_authority"("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('added', 'removed', 'scope_added', 'scope_removed', 'date_changed', 'renamed', 'expired', 'status_changed')),
  "before_json" text,
  "after_json" text,
  "snapshot_id" text NOT NULL REFERENCES "cert_snapshot"("id"),
  "detected_at" integer NOT NULL,
  "review_state" text NOT NULL DEFAULT 'pending' CHECK ("review_state" IN ('pending', 'published', 'rejected')),
  "reviewed_by" text,                        -- moderator user id, or 'auto' for the auto-publish policy
  "published_at" integer
);
CREATE INDEX "cert_change_review_idx" ON "cert_change" ("review_state", "detected_at");
CREATE INDEX "cert_change_certifier_idx" ON "cert_change" ("certifier_id", "published_at");
CREATE INDEX "cert_change_published_idx" ON "cert_change" ("review_state", "published_at");

-- Alert sign-ups. Stored unconfirmed: nothing is sent until double opt-in ships.
CREATE TABLE "cert_alert_sub" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,                     -- lowercased
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "filter_json" text NOT NULL,               -- {"authorities":[...],"certifiers":[...],"scopes":[...]}
  "frequency" text NOT NULL CHECK ("frequency" IN ('instant', 'weekly')),
  "confirmed_at" integer,
  "unsubscribed_at" integer,
  "provider_contact_id" text,                -- the email provider's contact id, once confirmed
  "created_at" integer NOT NULL
);
CREATE INDEX "cert_alert_sub_email_idx" ON "cert_alert_sub" ("email");
