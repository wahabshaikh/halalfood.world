/**
 * Carry the `places` listing rows across the baseline reset (spec §4.4).
 *
 *   npx tsx scripts/places-seed.ts export seed/places.jsonl   # before the reset
 *   npx tsx scripts/places-seed.ts import seed/places.jsonl   # after 0001_baseline
 *
 * Both talk to the remote D1 database named by CLOUDFLARE_D1_DATABASE_ID via the
 * REST API. Only listed rows and the columns the new schema keeps are carried;
 * everything user-generated is left behind on purpose.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { hiddenListingReason } from "@/lib/core/listing-visibility";
import { queryD1 } from "./d1-rest-client";

export const SEED_COLUMNS = [
  "id",
  "name",
  "city_slug",
  "street_address",
  "address_locality",
  "address_region",
  "postal_code",
  "address_country",
  "telephone",
  "website",
  "maps_url",
  "google_place_id",
  "serves_cuisine",
  "lat",
  "lng",
  "google_details_snapshot",
  "google_details_cached_at",
  "created_at",
] as const;

export type SeedPlace = Record<(typeof SEED_COLUMNS)[number], unknown>;

/** Normalize one exported row; null when it can't be carried. */
export function toSeedPlace(row: Record<string, unknown>): SeedPlace | null {
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.city_slug !== "string")
    return null;
  if (typeof row.street_address !== "string" || !row.street_address.trim()) return null;
  const cuisines = (() => {
    if (Array.isArray(row.serves_cuisine)) return row.serves_cuisine;
    try {
      const parsed = JSON.parse(String(row.serves_cuisine ?? "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })().filter((value): value is string => typeof value === "string");
  if (hiddenListingReason({ id: row.id, name: row.name })) return null;
  const out = {} as SeedPlace;
  for (const column of SEED_COLUMNS) out[column] = row[column] ?? null;
  out.serves_cuisine = JSON.stringify(cuisines);
  out.created_at = Number(row.created_at ?? row.scraped_at ?? Date.now()) || Date.now();
  return out;
}

const BATCH = 20;

/** INSERT statements for the places and their unchecked status rows. */
export function seedStatements(places: SeedPlace[], now = Date.now()): { sql: string; params: unknown[] }[] {
  const out: { sql: string; params: unknown[] }[] = [];
  for (let start = 0; start < places.length; start += BATCH) {
    const chunk = places.slice(start, start + BATCH);
    const columns = [...SEED_COLUMNS, "listing_status", "updated_at"];
    const row = `(${columns.map(() => "?").join(", ")})`;
    out.push({
      sql: `INSERT OR IGNORE INTO places (${columns.join(", ")}) VALUES ${chunk.map(() => row).join(", ")}`,
      params: chunk.flatMap((place) => [...SEED_COLUMNS.map((column) => place[column]), "listed", now]),
    });
    out.push({
      sql: `INSERT OR IGNORE INTO place_status (place_id, status, progress, eligible_checks, updated_at) VALUES ${chunk
        .map(() => "(?, 'unchecked', 0, 0, ?)")
        .join(", ")}`,
      params: chunk.flatMap((place) => [place.id, now]),
    });
  }
  return out;
}

async function exportPlaces(file: string) {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const page = await queryD1(
      `SELECT * FROM places WHERE listing_status = 'listed' ORDER BY id LIMIT 500 OFFSET ?`,
      [offset],
    );
    rows.push(...page);
    if (page.length < 500) break;
    offset += page.length;
  }
  const places = rows.map(toSeedPlace).filter((place): place is SeedPlace => place !== null);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, places.map((place) => JSON.stringify(place)).join("\n") + "\n");
  console.log(`Exported ${places.length} of ${rows.length} listed places to ${file}`);
}

async function importPlaces(file: string) {
  const places = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => toSeedPlace(JSON.parse(line)))
    .filter((place): place is SeedPlace => place !== null);
  for (const statement of seedStatements(places)) await queryD1(statement.sql, statement.params);
  console.log(`Imported ${places.length} places`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [mode, file = "seed/places.jsonl"] = process.argv.slice(2);
  const run = mode === "export" ? exportPlaces : mode === "import" ? importPlaces : null;
  if (!run) {
    console.error("Usage: tsx scripts/places-seed.ts export|import [file]");
    process.exit(2);
  }
  run(file).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
