-- Provenance, coverage and reputation, from the data expansion strategy.
--
-- Four non-negotiable principles drive this migration:
--   * every important fact carries provenance and an observation date;
--   * historical values are appended, never overwritten;
--   * conflicting sources are represented rather than averaged away;
--   * commercial payment can never reach a trust signal or an organic rank.

-- ---------------------------------------------------------------------------
-- 1. Source records and observations
-- ---------------------------------------------------------------------------

/*
 * A source record ties an external provider's identifier and retrieval to a
 * canonical place. Keeping this separate from `places` is what lets an adapter
 * be added or dropped without touching the product model.
 */
CREATE TABLE IF NOT EXISTS place_source_records (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_class TEXT NOT NULL,
  external_id TEXT,
  url TEXT,
  observed_at INTEGER NOT NULL,
  -- Licence and display constraints travel with the record, so a later export
  -- cannot accidentally redistribute something the terms did not permit.
  licence TEXT,
  attribution TEXT,
  payload_hash TEXT,
  created_at INTEGER NOT NULL,
  CHECK (source_class IN (
    'open-data','official-api','government','restaurant-owned','editorial',
    'community','commercial-platform','search-extraction'
  ))
);

CREATE INDEX IF NOT EXISTS place_source_records_place_idx
  ON place_source_records(place_id, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS place_source_records_identity_idx
  ON place_source_records(place_id, source, external_id);

/*
 * Append-only observations. A value is never updated in place: a change is a
 * new row with a later `observed_at`, which is what makes price history,
 * certification changes and ownership changes visible instead of silently
 * replaced.
 */
CREATE TABLE IF NOT EXISTS place_observations (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  source_class TEXT NOT NULL,
  source_record_id TEXT REFERENCES place_source_records(id) ON DELETE SET NULL,
  source_url TEXT,
  submitted_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  observed_at INTEGER NOT NULL,
  valid_until INTEGER,
  confidence TEXT NOT NULL DEFAULT 'medium',
  -- A superseded observation stays readable; it just stops being current.
  superseded_by_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (confidence IN ('high','medium','low')),
  CHECK (source_class IN (
    'open-data','official-api','government','restaurant-owned','editorial',
    'community','commercial-platform','search-extraction'
  )),
  CHECK (length(value) <= 2000)
);

CREATE INDEX IF NOT EXISTS place_observations_current_idx
  ON place_observations(place_id, predicate, observed_at DESC);
CREATE INDEX IF NOT EXISTS place_observations_predicate_idx
  ON place_observations(predicate, observed_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Official inspections and licences
-- ---------------------------------------------------------------------------

/*
 * Government evidence is a different class of trust signal from consumer
 * opinion, so it gets its own table and its own panel. It is never folded into
 * a diner score.
 */
CREATE TABLE IF NOT EXISTS place_inspections (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  authority TEXT NOT NULL,
  kind TEXT NOT NULL,
  grade TEXT,
  score INTEGER,
  licence_status TEXT,
  licence_number TEXT,
  inspected_at INTEGER,
  valid_until INTEGER,
  source_url TEXT,
  retrieved_at INTEGER NOT NULL,
  -- Identity matching against a government register is error-prone, so a match
  -- is explicit about how confident it is and whether a human confirmed it.
  match_confidence TEXT NOT NULL DEFAULT 'medium',
  match_reviewed_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (kind IN ('hygiene','licence','inspection')),
  CHECK (licence_status IS NULL OR licence_status IN ('active','expired','suspended','not-found')),
  CHECK (match_confidence IN ('high','medium','low')),
  CHECK (score IS NULL OR score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS place_inspections_place_idx
  ON place_inspections(place_id, inspected_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Coverage and city demand
-- ---------------------------------------------------------------------------

ALTER TABLE places ADD COLUMN coverage_level TEXT NOT NULL DEFAULT 'indexed';
ALTER TABLE places ADD COLUMN coverage_computed_at INTEGER;

CREATE INDEX IF NOT EXISTS places_coverage_idx ON places(city_slug, coverage_level);

/*
 * A visitor whose city is thin should be able to ask for it rather than meet a
 * dead end. These requests are the demand signal that orders the enrichment
 * queue.
 */
CREATE TABLE IF NOT EXISTS city_coverage_requests (
  id TEXT PRIMARY KEY,
  city_slug TEXT NOT NULL,
  requested_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  -- Hashed, never raw: this is a spam control, not a visitor log.
  requester_hash TEXT,
  wants_to_contribute INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL,
  CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS city_coverage_requests_city_idx
  ON city_coverage_requests(city_slug, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS city_coverage_requests_unique_idx
  ON city_coverage_requests(city_slug, requester_hash);

-- ---------------------------------------------------------------------------
-- 4. Reputation ladder
-- ---------------------------------------------------------------------------

/*
 * Promotion follows measured accuracy, not contribution volume. `accepted` and
 * `rejected` are the raw counts the accuracy rate is computed from; the role is
 * stored so a promotion is auditable rather than recomputed silently.
 */
CREATE TABLE IF NOT EXISTS contributor_standing (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'new',
  city_slug TEXT,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  verified_visits INTEGER NOT NULL DEFAULT 0,
  -- A proportionate, recoverable restriction rather than a permanent mark.
  restricted_until INTEGER,
  accepted_since_restriction INTEGER NOT NULL DEFAULT 0,
  founding_contributor_city TEXT,
  promoted_at INTEGER,
  promoted_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (role IN ('new','contributor','trusted','city-expert','city-moderator'))
);

CREATE INDEX IF NOT EXISTS contributor_standing_city_idx
  ON contributor_standing(city_slug, role);

-- ---------------------------------------------------------------------------
-- 5. Commercial placement, stored apart from ranking
-- ---------------------------------------------------------------------------

/*
 * Sponsorship lives in its own table on purpose. Nothing in the discovery query
 * joins it, so a paid row cannot reach organic order even by accident; the UI
 * reads it separately and always labels it.
 */
CREATE TABLE IF NOT EXISTS sponsored_placements (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  city_slug TEXT,
  label TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK (length(label) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS sponsored_placements_window_idx
  ON sponsored_placements(city_slug, starts_at, ends_at);

/*
 * Transaction handoffs are counted for revenue reporting and are deliberately
 * not joined to any scoring query.
 */
CREATE TABLE IF NOT EXISTS transaction_handoffs (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (action IN ('order','book','pickup','directions','menu','call'))
);

CREATE INDEX IF NOT EXISTS transaction_handoffs_place_idx
  ON transaction_handoffs(place_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Service as an independent dimension
-- ---------------------------------------------------------------------------

ALTER TABLE place_check_ins ADD COLUMN service_verdict TEXT;
