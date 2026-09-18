-- The remote migration runner skips an ADD COLUMN when that column already exists.
ALTER TABLE "places" ADD COLUMN "google_place_payload" TEXT;
ALTER TABLE "places" ADD COLUMN "google_place_fetched_at" INTEGER;
