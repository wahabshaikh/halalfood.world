/**
 * One-off backfill of place trust (lib/trust.ts): recompute trust_score,
 * trust_band, community_vouchers, creator_count and badges on every
 * `place_status` row and report what would change.
 *
 *   pnpm backfill:trust [--city london] [--apply]
 *
 * A dry run by default; --apply writes. Idempotent: a second run finds
 * nothing to change. Needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID
 * and CLOUDFLARE_API_TOKEN, like the other ops scripts.
 */
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { computeTrust, writeTrust, type PlaceTrustValues } from "@/lib/trust";
import { queryD1, restBinding } from "./d1-rest-client";

type Row = {
  place_id: string;
  trust_score: number;
  trust_band: string;
  community_vouchers: number;
  creator_count: number;
  badges: string;
};

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const same = (row: Row, next: PlaceTrustValues) =>
  Number(row.trust_score) === next.trustScore &&
  row.trust_band === next.trustBand &&
  Number(row.community_vouchers) === next.communityVouchers &&
  Number(row.creator_count) === next.creatorCount &&
  row.badges === next.badges;

async function main() {
  const apply = process.argv.includes("--apply");
  const city = option("--city");
  const rows = await queryD1<Row>(
    `SELECT s.place_id, s.trust_score, s.trust_band, s.community_vouchers, s.creator_count, s.badges
     FROM place_status s JOIN places p ON p.id = s.place_id
     ${city ? "WHERE p.city_slug = ?" : ""}
     ORDER BY s.place_id`,
    city ? [city] : [],
  );
  const db = drizzle(restBinding() as unknown as Parameters<typeof drizzle>[0], { schema });
  const now = Date.now();
  let changed = 0;
  for (const row of rows) {
    const next = await computeTrust(row.place_id, db, now);
    if (same(row, next)) continue;
    changed++;
    console.log(
      `  ${row.place_id}: ${row.trust_score} ${row.trust_band} [${row.badges}] → ${next.trustScore} ${next.trustBand} [${next.badges}]` +
        `, ${next.communityVouchers} vouchers, ${next.creatorCount} creators${next.review ? ", needs review (pork on the menu)" : ""}`,
    );
    if (apply) await writeTrust(row.place_id, next, db);
  }
  console.log(
    apply
      ? `${rows.length} places, ${changed} updated.`
      : `Dry run: ${rows.length} places, ${changed} would change, nothing written. Run again with --apply to write.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
