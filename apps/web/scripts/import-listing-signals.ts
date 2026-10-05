/**
 * Import map listings' halal tags as a signal (docs/product/halal-model.md).
 *
 * For each city, read every OpenStreetMap feature tagged `diet:halal` around
 * our listed places through Overpass, and Geoapify's halal places when
 * GEOAPIFY_API_KEY is set. Each listing that matches a place by name within
 * 80 m is stored in `place_signals` and the place's status is recomputed.
 *
 *   npm run signals:listings -- [--city london] [--dry-run]
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and
 * CLOUDFLARE_API_TOKEN, like the other ops scripts. A recompute's statements
 * run one at a time over the REST API rather than as one D1 batch.
 */
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import {
  bboxOf,
  geoapifyUrl,
  matchListings,
  mergeGeoapify,
  overpassQuery,
  parseGeoapify,
  parseOverpass,
  type Listing,
  type PlaceForMatch,
} from "../src/lib/listing-signals";
import { upsertListingSignal } from "../src/lib/place-evidence";
import { queryD1 } from "./d1-rest-client";

const OVERPASS_URL = process.env.OVERPASS_URL?.trim() || "https://overpass-api.de/api/interpreter";

/** Just enough of the D1 binding for drizzle, over the REST API. */
function restBinding() {
  const statement = (text: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(text, next),
    all: async () => ({ results: await queryD1(text, params), success: true, meta: {} }),
    run: async () => ({ results: await queryD1(text, params), success: true, meta: {} }),
    first: async () => (await queryD1(text, params))[0] ?? null,
    raw: async () => (await queryD1(text, params)).map((row) => Object.values(row)),
  });
  return {
    prepare: (text: string) => statement(text),
    async batch(statements: ReturnType<typeof statement>[]) {
      const out = [];
      for (const each of statements) out.push(await each.all());
      return out;
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

async function listingsFor(places: PlaceForMatch[]): Promise<Listing[]> {
  const box = bboxOf(places);
  if (!box) return [];
  const listings = parseOverpass(
    await fetchJson(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "halalfood.world listing import" },
      body: new URLSearchParams({ data: overpassQuery(box) }),
    }),
  );
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (apiKey) {
    const only = parseGeoapify(await fetchJson(geoapifyUrl(box, "halal.only", apiKey)), "only");
    const any = parseGeoapify(await fetchJson(geoapifyUrl(box, "halal", apiKey)), "yes");
    listings.push(...mergeGeoapify(only, any));
  }
  return listings;
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const city = option("--city");
  const rows = await queryD1<{ id: string; name: string; city_slug: string; lat: number; lng: number }>(
    `SELECT id, name, city_slug, lat, lng FROM places
     WHERE listing_status = 'listed' AND lat IS NOT NULL AND lng IS NOT NULL ${city ? "AND city_slug = ?" : ""}
     ORDER BY city_slug`,
    city ? [city] : [],
  );
  const byCity = new Map<string, PlaceForMatch[]>();
  for (const row of rows) {
    const list = byCity.get(row.city_slug) ?? [];
    list.push({ id: row.id, name: row.name, citySlug: row.city_slug, lat: Number(row.lat), lng: Number(row.lng) });
    byCity.set(row.city_slug, list);
  }

  const db = drizzle(restBinding() as unknown as Parameters<typeof drizzle>[0], { schema });
  let matched = 0;
  let changed = 0;
  for (const [slug, places] of byCity) {
    const listings = await listingsFor(places);
    const matches = matchListings(places, listings);
    matched += matches.length;
    console.log(`${slug}: ${places.length} places, ${listings.length} halal listings, ${matches.length} matched`);
    for (const { placeId, listing } of matches) {
      if (dryRun) {
        console.log(`  ${placeId} ← ${listing.provider} ${listing.externalId} "${listing.name}" (${listing.claim})`);
        continue;
      }
      const result = await upsertListingSignal(
        { placeId, provider: listing.provider, externalId: listing.externalId, claim: listing.claim },
        db,
      );
      if (result.changed) changed++;
    }
  }
  console.log(dryRun ? `Dry run: ${matched} matches, nothing written.` : `${matched} matches, ${changed} updated.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
