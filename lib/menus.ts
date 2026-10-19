/**
 * A place's menu and Halal Food Scout's menu check, as the place page shows
 * them. Writes are in lib/scout/menus.ts; the rules in lib/core/menus.ts.
 */
import { sql } from "drizzle-orm";
import {
  formatMenuPrice,
  groupMenuItems,
  parseMenuCheckStatus,
  parseMenuSourceType,
  type MenuCheckStatus,
  type MenuFlagReason,
  type MenuSourceType,
} from "@/lib/core/menus";
import { httpsSourceUrl } from "@/lib/core/place-claims";
import { database } from "@/lib/db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PlaceMenuItem = { position: number; section: string | null; name: string; description: string | null; price: string };
export type PlaceMenu = {
  capturedAt: number;
  sections: { section: string | null; items: PlaceMenuItem[] }[];
  itemCount: number;
  sources: { url: string; type: MenuSourceType }[];
};
export type PlaceMenuCheck = {
  status: MenuCheckStatus;
  checkedAt: number;
  sourceUrl: string | null;
  flags: { itemName: string; reason: MenuFlagReason; note: string | null }[];
};

/** The menu by section with formatted prices, and the latest menu check. Either may be null. */
export async function getPlaceMenu(placeId: string, client: Client = database()): Promise<{ menu: PlaceMenu | null; check: PlaceMenuCheck | null }> {
  const db = await client;
  const [menus, items, sources, checks, flags] = await Promise.all([
    db.all<{ captured_at: number }>(sql`SELECT captured_at FROM place_menus WHERE place_id = ${placeId}`),
    db.all<{ position: number; section: string | null; name: string; description: string | null; price: number; currency: string }>(sql`
      SELECT position, section, name, description, price, currency FROM place_menu_items WHERE place_id = ${placeId} ORDER BY position LIMIT 500
    `),
    db.all<{ url: string; type: string }>(sql`SELECT url, type FROM place_menu_sources WHERE place_id = ${placeId} ORDER BY position LIMIT 10`),
    db.all<{ status: string; checked_at: number; source_url: string | null }>(sql`
      SELECT status, checked_at, source_url FROM place_menu_checks WHERE place_id = ${placeId}
    `),
    db.all<{ item_name: string; reason: string; note: string | null }>(sql`
      SELECT item_name, reason, note FROM place_menu_check_flags WHERE place_id = ${placeId} ORDER BY position LIMIT 50
    `),
  ]);

  let menu: PlaceMenu | null = null;
  if (menus[0] && items.length) {
    const rows = items.map((item) => ({
      position: Number(item.position),
      section: item.section,
      name: item.name,
      description: item.description,
      price: formatMenuPrice(Number(item.price), item.currency),
    }));
    menu = {
      capturedAt: Number(menus[0].captured_at),
      sections: groupMenuItems(rows),
      itemCount: rows.length,
      // Sources are https when written; links are checked again before they render.
      sources: sources.flatMap((source) => {
        const url = httpsSourceUrl(source.url);
        return url ? [{ url, type: parseMenuSourceType(source.type) }] : [];
      }),
    };
  }

  const status = parseMenuCheckStatus(checks[0]?.status);
  const check: PlaceMenuCheck | null =
    checks[0] && status
      ? {
          status,
          checkedAt: Number(checks[0].checked_at),
          sourceUrl: checks[0].source_url ? httpsSourceUrl(checks[0].source_url) : null,
          flags: flags.flatMap((flag) =>
            flag.reason === "alcohol" || flag.reason === "pork" || flag.reason === "other" ? [{ itemName: flag.item_name, reason: flag.reason, note: flag.note }] : [],
          ),
        }
      : null;
  return { menu, check };
}
