-- The /community leaderboard sums granted contribution_points per city next to the old points ledger
-- (lib/community.ts), the way points_city_idx serves the ledger. Status leads created_at so the
-- granted-only, since-Monday range stays one index seek. Additive only.
CREATE INDEX IF NOT EXISTS "contribution_points_city_idx" ON "contribution_points" ("city_slug", "status", "created_at");
