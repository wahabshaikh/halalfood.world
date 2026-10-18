/**
 * Keeps `places.import_verified_at` in step with the evidence that an imported
 * place exists (lib/core/provenance.ts). `recomputePlaceStatus` calls it after
 * every status rebuild (checks, evidence review, Scout claims, moderation and
 * merges), and Scout's creator verification writes call it directly. Places
 * without an import source are never touched.
 */
import { sql } from "drizzle-orm";
import { isEligible } from "@/lib/core/halal";
import { nextImportVerifiedAt, seenToExist } from "@/lib/core/provenance";
import { database } from "@/lib/db";
import { publishListingChange } from "./listing-cache";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type VerificationRecompute = {
  /** False for places that were not imported: nothing to recompute. */
  imported: boolean;
  verifiedAt: number | null;
  changed: boolean;
};

/**
 * Recompute whether an imported place is verified to exist. `eligibleChecks`
 * skips reloading checks when the caller already derived the status; otherwise
 * the checks are read and counted with the same `isEligible` rule.
 */
export async function recomputePlaceVerification(
  placeId: string,
  client: Client = database(),
  now = Date.now(),
  eligibleChecks?: number,
): Promise<VerificationRecompute> {
  const db = await client;
  const [place] = await db.all<{ import_source: string | null; import_verified_at: number | null; city_slug: string }>(sql`
    SELECT import_source, import_verified_at, city_slug FROM places WHERE id = ${placeId}
  `);
  if (!place || place.import_source === null) return { imported: false, verifiedAt: null, changed: false };
  const current = place.import_verified_at === null ? null : Number(place.import_verified_at);

  const [evidence] = await db.all<Record<string, unknown>>(sql`
    SELECT
      (SELECT count(*) FROM place_signals WHERE place_id = ${placeId} AND source IN ('certificate', 'menu') AND review_status = 'approved') AS documents,
      (SELECT count(*) FROM creator_verifications WHERE place_id = ${placeId}) AS creators,
      (SELECT count(*) FROM place_claims WHERE place_id = ${placeId} AND source = 'scout' AND fact = 'certified' AND value = 'yes'
        AND source_url IS NOT NULL AND source_url <> '') AS claims
  `);
  const seen = seenToExist({
    eligibleChecks: eligibleChecks ?? (await countEligibleChecks(db, placeId)),
    approvedDocuments: Number(evidence?.documents ?? 0),
    creatorVerifications: Number(evidence?.creators ?? 0),
    sourcedCertifiedClaims: Number(evidence?.claims ?? 0),
  });
  const next = nextImportVerifiedAt(current, seen, now);
  if (next === current) return { imported: true, verifiedAt: current, changed: false };

  await db.run(sql`UPDATE places SET import_verified_at = ${next} WHERE id = ${placeId}`);
  // The place joins or leaves the sitemap: move cached listing reads on and purge its documents.
  await publishListingChange(
    { actorUserId: "system:provenance", change: next === null ? "import-unverified" : "import-verified", placeId, citySlug: place.city_slug },
    db,
  ).catch(() => null);
  return { imported: true, verifiedAt: next, changed: true };
}

async function countEligibleChecks(db: DatabaseClient, placeId: string): Promise<number> {
  // check-visibility: status — counts checks toward existence; nothing about authors leaves this function.
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT c.created_at, c.excluded, u.created_at AS author_created_at, pr.suspended_at
    FROM checks c
    JOIN "user" u ON u.id = c.user_id
    LEFT JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.place_id = ${placeId}
  `);
  return rows.filter((row) =>
    isEligible({
      createdAt: Number(row.created_at),
      authorCreatedAt: Number(row.author_created_at),
      excluded: Number(row.excluded) === 1,
      authorSuspended: row.suspended_at !== null && row.suspended_at !== undefined,
    }),
  ).length;
}
