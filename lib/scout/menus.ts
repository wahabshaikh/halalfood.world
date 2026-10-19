/**
 * upsert_menu, set_menu_check and set_place_logo for Halal Food Scout.
 *
 * A menu is a web source, context only (lib/core/menus.ts,
 * docs/spec/halal-model.md): one per place, replaced as a whole in one D1
 * batch, so a reader sees the old menu or the new one, never half of each.
 *
 * A menu check is Scout's automated read of that menu. A clean check only
 * shows a badge. A flagged check with alcohol or pork flags writes Scout
 * claims (alcohol = yes, pork = yes) through `applyClaims`, so it obeys the
 * same rule as `upsert_place`'s attributes: never over community checks or
 * approved documents, and newer Scout claims replace older ones.
 *
 * A logo is an external https image on the restaurant's site, stored as a URL
 * and rendered with no referrer; it is never fetched or proxied.
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_FLAG_NOTE,
  MAX_ITEM_DESCRIPTION,
  MAX_ITEM_NAME,
  MAX_MENU_FLAGS,
  MAX_MENU_ITEMS,
  MAX_MENU_SOURCES,
  MAX_SECTION,
  MENU_CHECK_STATUSES,
  MENU_FLAG_REASONS,
  MENU_SOURCE_TYPES,
  isCurrencyCode,
  menuCheckFacts,
  normalizeMenu,
  normalizeMenuCheck,
  parseCapturedAt,
  parseMenuSourceType,
  sameMenu,
  type MenuCheckStatus,
  type MenuSource,
} from "@/lib/core/menus";
import { httpsSourceUrl, type ClaimOutcome } from "@/lib/core/place-claims";
import { runBatch } from "@/lib/checks-repository";
import { publishListingChange } from "@/lib/listing-cache";
import { recomputeTrust } from "@/lib/trust";
import { applyClaims } from "./claims";
import type { ScoutDeps } from "./deps";
import { targetPlace, type PlaceFailure } from "./places";

const placeRef = z.string().trim().min(1).max(64).describe("The place id from find_place or upsert_place.");
const httpsUrl = (what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => httpsSourceUrl(value) !== null, `${what} must be an https URL (http is refused).`);
const currency = z
  .string()
  .trim()
  .refine(isCurrencyCode, "Currencies are ISO 4217 codes: three capital letters, like GBP, INR or USD.");
const isoDate = z.string().max(40).describe("ISO date or date-time, e.g. 2026-10-18. Defaults to now.");

export const menuItemInput = z.object({
  name: z.string().trim().min(1).max(MAX_ITEM_NAME),
  price: z.number().min(0).describe("In the currency's major unit, as published: 12.5 for £12.50, 250 for ₹250."),
  currency: currency.optional().describe("ISO 4217. Defaults to the menu's currency."),
  section: z.string().trim().max(MAX_SECTION).optional().describe("The menu heading it sits under, e.g. Grills. Items without one are grouped together."),
  description: z.string().trim().max(MAX_ITEM_DESCRIPTION).optional(),
});

export const menuSourceInput = z.object({
  url: httpsUrl("Menu source URLs").describe("The https page the menu was read from."),
  type: z.enum(MENU_SOURCE_TYPES),
});

export const upsertMenuInput = z
  .object({
    place_id: placeRef,
    currency: currency.optional().describe("ISO 4217 code for every item that doesn't name its own."),
    captured_at: isoDate.optional(),
    sources: z.array(menuSourceInput).min(1).max(MAX_MENU_SOURCES),
    items: z.array(menuItemInput).min(1).max(MAX_MENU_ITEMS).describe(`The whole menu in published order, at most ${MAX_MENU_ITEMS} items.`),
  })
  .refine((value) => value.currency !== undefined || value.items.every((item) => item.currency !== undefined), {
    message: "Send a currency on the menu or on every item.",
    path: ["currency"],
  });
export type UpsertMenuInput = z.infer<typeof upsertMenuInput>;

export const menuFlagInput = z
  .object({
    item: z.string().trim().min(1).max(MAX_ITEM_NAME).optional().describe("The name of an item on the place's stored menu."),
    name: z.string().trim().min(1).max(MAX_ITEM_NAME).optional().describe("What was found when it isn't a menu item, e.g. Wine list."),
    reason: z.enum(MENU_FLAG_REASONS),
    note: z.string().trim().max(MAX_FLAG_NOTE).optional(),
  })
  .refine((value) => (value.item === undefined) !== (value.name === undefined), { message: "Send item or name, not both." });

export const setMenuCheckInput = z
  .object({
    place_id: placeRef,
    status: z.enum(MENU_CHECK_STATUSES),
    flags: z.array(menuFlagInput).max(MAX_MENU_FLAGS).optional().describe("Required for flagged, refused otherwise."),
    source_url: httpsUrl("source_url").optional().describe("The https page that was checked. Defaults to the stored menu's first source."),
    checked_at: isoDate.optional(),
  })
  .refine((value) => (value.status === "flagged") === Boolean(value.flags?.length), {
    message: "A flagged check needs at least one flag; clean and no_menu take none.",
    path: ["flags"],
  });
export type SetMenuCheckInput = z.infer<typeof setMenuCheckInput>;

export const setPlaceLogoInput = z.object({
  place_id: placeRef,
  logo_url: httpsUrl("logo_url").nullable().describe("https URL of the logo image on the restaurant's own site, or null to remove it."),
  source_url: httpsUrl("source_url").optional().describe("The https page the logo was found on. Required with a logo_url."),
}).refine((value) => value.logo_url === null || value.source_url !== undefined, { message: "Send the source_url the logo was found on.", path: ["source_url"] });
export type SetPlaceLogoInput = z.infer<typeof setPlaceLogoInput>;

export type UpsertMenuResult =
  | { ok: true; result: "created" | "updated" | "unchanged"; place_id: string; place_url: string; items: number; sections: number; sources: number; captured_at: string }
  | PlaceFailure;

export type SetMenuCheckResult =
  | {
      ok: true;
      result: "created" | "updated" | "unchanged";
      place_id: string;
      place_url: string;
      status: MenuCheckStatus;
      flags: number;
      /** The Scout claims a flagged check asked for, per fact, with what happened (set, updated, unchanged, kept_existing). */
      claims: Partial<Record<"alcohol" | "pork", ClaimOutcome>>;
      badge: boolean;
    }
  | PlaceFailure;

export type SetPlaceLogoResult = { ok: true; result: "set" | "updated" | "unchanged" | "cleared"; place_id: string; logo_url: string | null } | PlaceFailure;

type StoredItem = { id: string; position: number; section: string | null; name: string; description: string | null; price: number; currency: string };

async function storedMenu(deps: ScoutDeps, placeId: string): Promise<{ capturedAt: number; items: StoredItem[]; sources: MenuSource[] } | null> {
  const [menu] = await deps.db.all<{ captured_at: number }>(sql`SELECT captured_at FROM place_menus WHERE place_id = ${placeId}`);
  if (!menu) return null;
  const [items, sources] = await Promise.all([
    deps.db.all<StoredItem>(sql`
      SELECT id, position, section, name, description, price, currency FROM place_menu_items WHERE place_id = ${placeId} ORDER BY position
    `),
    deps.db.all<{ position: number; url: string; type: string }>(sql`
      SELECT position, url, type FROM place_menu_sources WHERE place_id = ${placeId} ORDER BY position
    `),
  ]);
  return {
    capturedAt: Number(menu.captured_at),
    items: items.map((item) => ({ ...item, position: Number(item.position), price: Number(item.price) })),
    sources: sources.map((source) => ({ position: Number(source.position), url: source.url, type: parseMenuSourceType(source.type) })),
  };
}

/** Rows per multi-row INSERT: 8 bound values per item keeps a statement under D1's 100 parameters. */
const ITEM_ROWS_PER_INSERT = 12;

/** Replace a place's menu: items and sources as a whole, in one batch. */
export async function upsertMenu(deps: ScoutDeps, input: UpsertMenuInput): Promise<UpsertMenuResult> {
  const target = await targetPlace(deps, input.place_id);
  if (!target.ok) return target;
  const placeId = target.place.id;
  const normalized = normalizeMenu({ items: input.items, sources: input.sources, currency: input.currency });
  if (!normalized.ok) return normalized;
  const now = deps.now();
  const captured = parseCapturedAt(input.captured_at, now);
  if (!captured.ok) return captured;
  const menu = normalized.value;
  const sections = new Set(menu.items.map((item) => (item.section ?? "").toLocaleLowerCase())).size;
  const reply = (result: "created" | "updated" | "unchanged", capturedAt: number): UpsertMenuResult => ({
    ok: true,
    result,
    place_id: placeId,
    place_url: `${deps.origin}/place/${placeId}`,
    items: menu.items.length,
    sections,
    sources: menu.sources.length,
    captured_at: new Date(capturedAt).toISOString(),
  });

  const existing = await storedMenu(deps, placeId);
  if (existing && sameMenu(existing, menu)) {
    // The same menu read again: only a newer read date moves.
    if (captured.value > existing.capturedAt)
      await deps.db.run(sql`UPDATE place_menus SET captured_at = ${captured.value}, updated_at = ${now} WHERE place_id = ${placeId}`);
    return reply("unchanged", Math.max(captured.value, existing.capturedAt));
  }

  const statements: SQL[] = [
    sql`INSERT INTO place_menus (place_id, source, captured_at, created_at, updated_at) VALUES (${placeId}, 'scout', ${captured.value}, ${now}, ${now})
        ON CONFLICT (place_id) DO UPDATE SET source = 'scout', captured_at = excluded.captured_at, updated_at = excluded.updated_at`,
    sql`DELETE FROM place_menu_items WHERE place_id = ${placeId}`,
    sql`DELETE FROM place_menu_sources WHERE place_id = ${placeId}`,
  ];
  for (let start = 0; start < menu.items.length; start += ITEM_ROWS_PER_INSERT) {
    const rows = menu.items
      .slice(start, start + ITEM_ROWS_PER_INSERT)
      .map((item) => sql`(${crypto.randomUUID()}, ${placeId}, ${item.position}, ${item.section}, ${item.name}, ${item.description}, ${item.price}, ${item.currency})`);
    statements.push(sql`INSERT INTO place_menu_items (id, place_id, position, section, name, description, price, currency) VALUES ${sql.join(rows, sql`, `)}`);
  }
  const sourceRows = menu.sources.map((source) => sql`(${crypto.randomUUID()}, ${placeId}, ${source.position}, ${source.url}, ${source.type})`);
  statements.push(sql`INSERT INTO place_menu_sources (id, place_id, position, url, type) VALUES ${sql.join(sourceRows, sql`, `)}`);
  await runBatch(deps.db, statements);
  // A menu adds to trust (lib/trust.ts); it never touches halal status.
  if (!existing) await recomputeTrust(placeId, deps.db, now);
  return reply(existing ? "updated" : "created", captured.value);
}

/** Record Scout's menu check for a place, and the Scout claims a flagged one asks for. */
export async function setMenuCheck(deps: ScoutDeps, input: SetMenuCheckInput): Promise<SetMenuCheckResult> {
  const target = await targetPlace(deps, input.place_id);
  if (!target.ok) return target;
  const placeId = target.place.id;
  const menu = await storedMenu(deps, placeId);
  const normalized = normalizeMenuCheck({ status: input.status, flags: input.flags, sourceUrl: input.source_url }, menu?.items ?? []);
  if (!normalized.ok) return normalized;
  const now = deps.now();
  const checked = parseCapturedAt(input.checked_at, now);
  if (!checked.ok) return checked;
  const { status, flags } = normalized.value;
  const sourceUrl = normalized.value.sourceUrl ?? menu?.sources[0]?.url ?? null;
  const facts = menuCheckFacts(status, flags);
  if (facts.length && !sourceUrl)
    return {
      ok: false,
      error: "missing_source",
      message: "An alcohol or pork flag becomes a web claim, which cites a page: send source_url, or upsert the menu with its sources first.",
    };

  const [existing] = await deps.db.all<{ status: string; source_url: string | null }>(sql`SELECT status, source_url FROM place_menu_checks WHERE place_id = ${placeId}`);
  const existingFlags = existing
    ? await deps.db.all<{ item_name: string; reason: string; note: string | null }>(sql`
        SELECT item_name, reason, note FROM place_menu_check_flags WHERE place_id = ${placeId} ORDER BY position
      `)
    : [];
  const flagKey = (list: { item_name: string; reason: string; note: string | null }[]) => JSON.stringify(list.map((flag) => [flag.item_name, flag.reason, flag.note]));
  const same =
    existing?.status === status &&
    existing.source_url === sourceUrl &&
    flagKey(existingFlags) === flagKey(flags.map((flag) => ({ item_name: flag.itemName, reason: flag.reason, note: flag.note })));

  const itemIds = new Map(menu?.items.map((item) => [item.position, item.id]) ?? []);
  if (same) await deps.db.run(sql`UPDATE place_menu_checks SET checked_at = max(checked_at, ${checked.value}), updated_at = ${now} WHERE place_id = ${placeId}`);
  else
    await runBatch(deps.db, [
      sql`INSERT INTO place_menu_checks (place_id, status, source, source_url, checked_at, created_at, updated_at)
          VALUES (${placeId}, ${status}, 'scout', ${sourceUrl}, ${checked.value}, ${now}, ${now})
          ON CONFLICT (place_id) DO UPDATE SET status = excluded.status, source = 'scout', source_url = excluded.source_url,
            checked_at = excluded.checked_at, updated_at = excluded.updated_at`,
      sql`DELETE FROM place_menu_check_flags WHERE place_id = ${placeId}`,
      ...flags.map(
        (flag) => sql`INSERT INTO place_menu_check_flags (id, place_id, position, item_id, item_name, reason, note)
          VALUES (${crypto.randomUUID()}, ${placeId}, ${flag.position}, ${flag.itemPosition === null ? null : (itemIds.get(flag.itemPosition) ?? null)},
            ${flag.itemName}, ${flag.reason}, ${flag.note})`,
      ),
    ]);

  // Only a flagged check reaches here with facts; a clean one never writes a claim.
  const claims: Partial<Record<"alcohol" | "pork", ClaimOutcome>> = {};
  if (facts.length) {
    const applied = await applyClaims(deps, placeId, {
      ...(facts.includes("alcohol") ? { no_alcohol: { value: "no" as const, source_url: sourceUrl! } } : {}),
      ...(facts.includes("pork") ? { no_pork: { value: "no" as const, source_url: sourceUrl! } } : {}),
    });
    if (applied.outcomes.no_alcohol) claims.alcohol = applied.outcomes.no_alcohol;
    if (applied.outcomes.no_pork) claims.pork = applied.outcomes.no_pork;
    // Claims move a place in and out of filtered listings.
    if (applied.changed)
      await publishListingChange({ actorUserId: "mcp:scout", change: "place-claims", placeId, citySlug: target.place.citySlug }, deps.db).catch(() => null);
  }
  // Pork on the menu caps trust and alcohol earns a badge, even when the claims were kept (lib/trust.ts).
  if (!same) await recomputeTrust(placeId, deps.db, now);
  return {
    ok: true,
    result: same ? "unchanged" : existing ? "updated" : "created",
    place_id: placeId,
    place_url: `${deps.origin}/place/${placeId}`,
    status,
    flags: flags.length,
    claims,
    badge: status === "clean",
  };
}

/** Set, replace or remove a place's logo. Cards show it, so listings are refreshed. */
export async function setPlaceLogo(deps: ScoutDeps, input: SetPlaceLogoInput): Promise<SetPlaceLogoResult> {
  const target = await targetPlace(deps, input.place_id);
  if (!target.ok) return target;
  const placeId = target.place.id;
  const logoUrl = input.logo_url === null ? null : httpsSourceUrl(input.logo_url);
  const sourceUrl = input.logo_url === null || !input.source_url ? null : httpsSourceUrl(input.source_url);
  if (input.logo_url !== null && (!logoUrl || !sourceUrl))
    return { ok: false, error: "invalid_url", message: "logo_url and source_url must be https URLs (http is refused)." };
  const [row] = await deps.db.all<{ logo_url: string | null; logo_source_url: string | null }>(sql`SELECT logo_url, logo_source_url FROM places WHERE id = ${placeId}`);
  const result = logoUrl === null ? (row?.logo_url ? "cleared" : "unchanged") : row?.logo_url === logoUrl && row.logo_source_url === sourceUrl ? "unchanged" : row?.logo_url ? "updated" : "set";
  if (result !== "unchanged") {
    await deps.db.run(sql`UPDATE places SET logo_url = ${logoUrl}, logo_source_url = ${sourceUrl}, updated_at = ${deps.now()} WHERE id = ${placeId}`);
    await publishListingChange({ actorUserId: "mcp:scout", change: "place-logo", placeId, citySlug: target.place.citySlug }, deps.db).catch(() => null);
  }
  return { ok: true, result, place_id: placeId, logo_url: logoUrl };
}
