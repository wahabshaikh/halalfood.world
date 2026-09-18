-- Trust-first restaurant network: preferences, facts, dishes, evidence
-- attributes, visits, check-ins, lists, contributions, moderation, audit.
--
-- Every table below is additive. Existing place, saved-place, rating, review,
-- photo and verification rows keep working unchanged.

-- ---------------------------------------------------------------------------
-- 1. Dietary standards and personal context
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  -- Minimum halal status the user is willing to consider, by taxonomy rank.
  minimum_status TEXT NOT NULL DEFAULT 'self-declared',
  require_certification INTEGER NOT NULL DEFAULT 0,
  avoid_alcohol INTEGER NOT NULL DEFAULT 0,
  avoid_pork INTEGER NOT NULL DEFAULT 0,
  require_dedicated_kitchen INTEGER NOT NULL DEFAULT 0,
  require_prayer_space INTEGER NOT NULL DEFAULT 0,
  vegetarian_only INTEGER NOT NULL DEFAULT 0,
  max_evidence_age_days INTEGER,
  allergies TEXT NOT NULL DEFAULT '[]',
  cuisines TEXT NOT NULL DEFAULT '[]',
  home_city_slug TEXT,
  visibility_visits TEXT NOT NULL DEFAULT 'public',
  visibility_lists TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (minimum_status IN (
    'verified','community-verified','halal-options','self-declared','unverified'
  )),
  CHECK (visibility_visits IN ('public','private')),
  CHECK (visibility_lists IN ('public','private')),
  CHECK (max_evidence_age_days IS NULL OR max_evidence_age_days BETWEEN 1 AND 3650)
);

-- Public pseudonym so a diner profile never has to expose an email address.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT,
  bio TEXT,
  home_city_slug TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(handle) BETWEEN 3 AND 32),
  CHECK (bio IS NULL OR length(bio) <= 280)
);

-- ---------------------------------------------------------------------------
-- 2. Independent factual attributes (never collapsed into one badge)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS place_facts (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  serves_alcohol TEXT NOT NULL DEFAULT 'unknown',
  serves_pork TEXT NOT NULL DEFAULT 'unknown',
  dedicated_halal_kitchen TEXT NOT NULL DEFAULT 'unknown',
  muslim_owned TEXT NOT NULL DEFAULT 'unknown',
  prayer_space TEXT NOT NULL DEFAULT 'unknown',
  women_friendly_facilities TEXT NOT NULL DEFAULT 'unknown',
  vegetarian_options TEXT NOT NULL DEFAULT 'unknown',
  certification_body TEXT,
  price_band INTEGER,
  service_types TEXT NOT NULL DEFAULT '[]',
  meals TEXT NOT NULL DEFAULT '[]',
  neighbourhood TEXT,
  brand_slug TEXT,
  branch_label TEXT,
  reservation_url TEXT,
  delivery_url TEXT,
  menu_url TEXT,
  updated_at INTEGER NOT NULL,
  updated_by_user_id TEXT,
  CHECK (serves_alcohol IN ('yes','no','unknown')),
  CHECK (serves_pork IN ('yes','no','unknown')),
  CHECK (dedicated_halal_kitchen IN ('yes','no','unknown')),
  CHECK (muslim_owned IN ('yes','no','unknown')),
  CHECK (prayer_space IN ('yes','no','unknown')),
  CHECK (women_friendly_facilities IN ('yes','no','unknown')),
  CHECK (vegetarian_options IN ('yes','no','unknown')),
  CHECK (price_band IS NULL OR price_band BETWEEN 1 AND 4)
);

CREATE INDEX IF NOT EXISTS place_facts_brand_idx ON place_facts(brand_slug);

-- ---------------------------------------------------------------------------
-- 3. Evidence attributes: scope, source, recency, disclosure
-- ---------------------------------------------------------------------------

ALTER TABLE place_halal_verifications ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'first-hand';
ALTER TABLE place_halal_verifications ADD COLUMN claimed_status TEXT NOT NULL DEFAULT 'self-declared';
ALTER TABLE place_halal_verifications ADD COLUMN scope TEXT NOT NULL DEFAULT 'venue';
ALTER TABLE place_halal_verifications ADD COLUMN scope_note TEXT;
ALTER TABLE place_halal_verifications ADD COLUMN certification_body TEXT;
ALTER TABLE place_halal_verifications ADD COLUMN certificate_id TEXT;
ALTER TABLE place_halal_verifications ADD COLUMN captured_at INTEGER;
ALTER TABLE place_halal_verifications ADD COLUMN expires_at INTEGER;
ALTER TABLE place_halal_verifications ADD COLUMN relationship TEXT NOT NULL DEFAULT 'none';
ALTER TABLE place_halal_verifications ADD COLUMN incentivized INTEGER NOT NULL DEFAULT 0;
ALTER TABLE place_halal_verifications ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE place_halal_verifications ADD COLUMN reviewed_by_user_id TEXT;
ALTER TABLE place_halal_verifications ADD COLUMN review_reason TEXT;
ALTER TABLE place_halal_verifications ADD COLUMN superseded_by_id TEXT;

CREATE INDEX IF NOT EXISTS place_halal_verifications_expiry_idx
  ON place_halal_verifications(status, expires_at);

-- Prior statuses and the evidence that caused each change.
CREATE TABLE IF NOT EXISTS place_halal_status_history (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  previous_confidence TEXT,
  next_confidence TEXT NOT NULL,
  verification_id TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS place_halal_status_history_place_idx
  ON place_halal_status_history(place_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Dishes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS place_dishes (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  cuisine TEXT,
  price_minor INTEGER,
  currency TEXT,
  halal_scope TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  captured_at INTEGER,
  submitted_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CHECK (halal_scope IN ('halal','not-halal','unknown')),
  CHECK (status IN ('pending','accepted','needs-evidence','rejected','superseded')),
  CHECK (price_minor IS NULL OR price_minor BETWEEN 0 AND 100000000)
);

CREATE UNIQUE INDEX IF NOT EXISTS place_dishes_place_name_idx
  ON place_dishes(place_id, normalized_name);
CREATE INDEX IF NOT EXISTS place_dishes_normalized_idx ON place_dishes(normalized_name);

-- ---------------------------------------------------------------------------
-- 5. Visits and the ten-second check-in
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS place_visits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL,
  -- Derived verification result only. Raw coordinates and receipt content are
  -- deliberately not stored here; see docs/product/trust-platform.md.
  verification_method TEXT NOT NULL DEFAULT 'none',
  verification_confidence TEXT NOT NULL DEFAULT 'none',
  verification_detail TEXT,
  receipt_r2_key TEXT,
  context TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (verification_method IN ('none','location','receipt','reservation','payment')),
  CHECK (verification_confidence IN ('none','low','medium','high')),
  CHECK (visibility IN ('public','private'))
);

CREATE INDEX IF NOT EXISTS place_visits_place_idx ON place_visits(place_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS place_visits_user_idx ON place_visits(user_id, visited_at DESC);

CREATE TABLE IF NOT EXISTS place_check_ins (
  visit_id TEXT PRIMARY KEY REFERENCES place_visits(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  would_return TEXT NOT NULL,
  would_bring_friend TEXT,
  value_verdict TEXT NOT NULL,
  spend_minor INTEGER,
  currency TEXT,
  note TEXT,
  incentivized INTEGER NOT NULL DEFAULT 0,
  relationship TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (would_return IN ('definitely','maybe','no')),
  CHECK (would_bring_friend IS NULL OR would_bring_friend IN ('yes','maybe','no')),
  CHECK (value_verdict IN ('great','fair','overpriced')),
  CHECK (note IS NULL OR length(note) <= 2000),
  CHECK (spend_minor IS NULL OR spend_minor BETWEEN 0 AND 100000000)
);

CREATE INDEX IF NOT EXISTS place_check_ins_place_idx ON place_check_ins(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS place_check_ins_user_idx ON place_check_ins(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS place_check_in_dishes (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES place_visits(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  dish_id TEXT REFERENCES place_dishes(id) ON DELETE SET NULL,
  dish_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  verdict TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (verdict IN ('order-again','fine','avoid'))
);

CREATE INDEX IF NOT EXISTS place_check_in_dishes_place_idx
  ON place_check_in_dishes(place_id, normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS place_check_in_dishes_visit_dish_idx
  ON place_check_in_dishes(visit_id, normalized_name);

ALTER TABLE place_photos ADD COLUMN visit_id TEXT;
CREATE INDEX IF NOT EXISTS place_photos_visit_idx ON place_photos(visit_id);

-- ---------------------------------------------------------------------------
-- 6. Saving and planning
-- ---------------------------------------------------------------------------

ALTER TABLE saved_places ADD COLUMN intent TEXT NOT NULL DEFAULT 'want-to-try';
ALTER TABLE saved_places ADD COLUMN note TEXT;

CREATE TABLE IF NOT EXISTS place_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  ranked INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(trim(title)) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR length(description) <= 1000),
  CHECK (visibility IN ('public','unlisted','private'))
);

CREATE UNIQUE INDEX IF NOT EXISTS place_lists_user_slug_idx ON place_lists(user_id, slug);
CREATE INDEX IF NOT EXISTS place_lists_visibility_idx ON place_lists(visibility, updated_at DESC);

CREATE TABLE IF NOT EXISTS place_list_items (
  list_id TEXT NOT NULL REFERENCES place_lists(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, place_id),
  CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS place_list_items_order_idx ON place_list_items(list_id, position);

-- ---------------------------------------------------------------------------
-- 7. Community contributions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS place_edit_suggestions (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  current_value TEXT,
  proposed_value TEXT NOT NULL,
  source_url TEXT,
  note TEXT,
  relationship TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  reviewed_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status IN ('pending','accepted','needs-evidence','rejected','superseded')),
  CHECK (length(proposed_value) <= 2000)
);

CREATE INDEX IF NOT EXISTS place_edit_suggestions_place_idx
  ON place_edit_suggestions(place_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS place_edit_suggestions_user_idx
  ON place_edit_suggestions(submitted_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS place_duplicate_reports (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  duplicate_of_place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  reviewed_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (place_id <> duplicate_of_place_id),
  CHECK (status IN ('pending','accepted','rejected','superseded'))
);

CREATE INDEX IF NOT EXISTS place_duplicate_reports_status_idx
  ON place_duplicate_reports(status, created_at);

-- ---------------------------------------------------------------------------
-- 8. Moderation, reports, appeals, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS moderators (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'moderator',
  created_at INTEGER NOT NULL,
  CHECK (role IN ('moderator','admin'))
);

CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reported_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  reviewed_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (target_type IN ('place','verification','check-in','photo','list','dish','user')),
  CHECK (reason IN (
    'factual-error','fraud','harassment','religious-misrepresentation',
    'incentivized','duplicate','other'
  )),
  CHECK (status IN ('open','upheld','dismissed','appealed','appeal-upheld','appeal-dismissed')),
  CHECK (detail IS NULL OR length(detail) <= 2000)
);

CREATE INDEX IF NOT EXISTS content_reports_status_idx ON content_reports(status, created_at);
CREATE INDEX IF NOT EXISTS content_reports_target_idx ON content_reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS report_appeals (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES content_reports(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  outcome TEXT,
  reviewed_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status IN ('open','upheld','dismissed')),
  CHECK (length(reason) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS report_appeals_report_idx ON report_appeals(report_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  source TEXT,
  before_value TEXT,
  after_value TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_user_id, created_at DESC);
