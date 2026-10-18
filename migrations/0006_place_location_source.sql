-- Additive: track coordinate provenance so Scout corrections cannot overwrite trusted pins.
-- Deliberately no backfill: null submitters, claims and verifications do not prove
-- Scout creation. Every existing source remains NULL (unknown/protected).
-- Explicit relocation may prove legacy Scout creation from its place-added audit
-- in application code; never infer provenance from coordinates or address text.
ALTER TABLE places ADD COLUMN location_source TEXT;
