/** D1 access for the dish catalogue. */

import { sql } from "drizzle-orm";
import { database } from "../db";
import type { ValidatedDish } from "@halalfood/core/contributions";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type PlaceDish = {
  id: string;
  name: string;
  normalizedName: string;
  cuisine: string | null;
  priceMinor: number | null;
  currency: string | null;
  halalScope: "halal" | "not-halal" | "unknown";
  sourceUrl: string | null;
  capturedAt: number | null;
  status: string;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function listDishes(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceDish[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, name, normalized_name, cuisine, price_minor, currency, halal_scope,
      source_url, captured_at, status
    FROM place_dishes
    WHERE place_id = ${placeId} AND status IN ('accepted', 'pending')
    ORDER BY status = 'accepted' DESC, name COLLATE NOCASE
    LIMIT 300
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    normalizedName: String(row.normalized_name ?? ""),
    cuisine: typeof row.cuisine === "string" ? row.cuisine : null,
    priceMinor: num(row.price_minor),
    currency: typeof row.currency === "string" ? row.currency : null,
    halalScope:
      row.halal_scope === "halal" || row.halal_scope === "not-halal"
        ? row.halal_scope
        : "unknown",
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    capturedAt: num(row.captured_at),
    status: String(row.status ?? "accepted"),
  }));
}

export type DishCreateResult =
  | { ok: true; id: string; status: string }
  | { ok: false; reason: "duplicate" };

/**
 * Dishes with a cited source go live; an uncited contribution waits for review,
 * so the menu cannot be rewritten without provenance.
 */
export async function createDish(
  placeId: string,
  userId: string,
  dish: ValidatedDish,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<DishCreateResult> {
  const db = await client;
  const existing = await db.all<{ id: string }>(sql`
    SELECT id FROM place_dishes
    WHERE place_id = ${placeId} AND normalized_name = ${dish.normalizedName}
    LIMIT 1
  `);
  if (existing.length) return { ok: false, reason: "duplicate" };

  const id = crypto.randomUUID();
  const now = Date.now();
  const status = dish.sourceUrl ? "accepted" : "pending";
  await db.run(sql`
    INSERT INTO place_dishes (
      id, place_id, name, normalized_name, cuisine, price_minor, currency,
      halal_scope, source_url, captured_at, submitted_by_user_id, status,
      created_at, updated_at
    ) VALUES (
      ${id}, ${placeId}, ${dish.name}, ${dish.normalizedName}, ${dish.cuisine},
      ${dish.priceMinor}, ${dish.currency}, ${dish.halalScope}, ${dish.sourceUrl},
      ${dish.capturedAt}, ${userId}, ${status}, ${now}, ${now}
    )
  `);
  return { ok: true, id, status };
}
