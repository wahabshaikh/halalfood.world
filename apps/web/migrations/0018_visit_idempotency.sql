-- One check-in submission, including a retry of the same submission, is one visit.
-- Keep comments here free of quote characters: the remote migration runner
-- splits statements with a quote-aware scanner that does not skip comments.

ALTER TABLE "place_visits" ADD COLUMN "idempotency_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "place_visits_idempotency_idx"
  ON "place_visits" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
