-- Sourced web claims about a place, written by Halal Food Scout (/api/mcp). Additive only.
--
-- A claim is one value for one question, with the web page that says it and when it was written: "Halal
-- certified: yes (HMC), per https://…". It is evidence of the same kind as a map listing in place_signals:
-- it fills a fact's current value only when no community check or approved certificate or menu answers it,
-- never settles a fact and never moves a place off "Not checked yet" (docs/spec/halal-model.md).
--
-- place_signals can't hold these: its CHECK on "source" can't be widened without rebuilding the table.
-- So fact, value and source have no CHECK here either; lib/core/place-claims.ts validates them, and a new
-- source or fact can be added later without a rebuild.
--   fact    owned | certified | pork | alcohol (the four halal facts)
--   value   yes | no
--   source  scout
-- One claim per place, fact and source: a newer Scout write replaces the older one.

CREATE TABLE "place_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "fact" text NOT NULL,
  "value" text NOT NULL,
  -- The https page that makes the claim.
  "source_url" text NOT NULL CHECK (length("source_url") <= 500),
  -- certified = yes only: the certifying body, as the source names it.
  "certifier" text CHECK ("certifier" IS NULL OR length("certifier") <= 120),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX "place_claims_unique_idx" ON "place_claims" ("place_id", "fact", "source");

