/**
 * Restaurant menus as data, and Halal Food Scout's menu check.
 *
 * A menu here is the menu a restaurant publishes (its site, a delivery
 * listing), read by Halal Food Scout. In the halal model it is a web source,
 * context only, like a Scout claim (docs/spec/halal-model.md). It is not the
 * moderator-approved menu photo (`place_signals`, source "menu") that settles
 * pork and alcohol: nothing here reaches `resolveFact`.
 *
 * The menu check rule (`menuCheckFacts`, `showsMenuBadge`):
 *
 * - clean: shows the badge "Menu checked: no alcohol · no pork". It never
 *   changes a status and never sets or settles a fact; it writes no claims,
 *   not even "no" ones, and leaves earlier ones alone.
 * - flagged: each flag with reason alcohol or pork asks for a Scout claim
 *   that the place serves it (alcohol = yes, pork = yes), citing the menu's
 *   source URL. The claim goes through the usual Scout-claim rule
 *   (`planClaim` in ./place-claims.ts): it is only written when no community
 *   check or approved document answers the fact, and it replaces Scout's
 *   older claim. Reason "other" writes nothing.
 * - no_menu: nothing but the record that Scout looked.
 */
import { httpsSourceUrl } from "./place-claims";

export const MENU_SOURCE_TYPES = ["website", "zomato", "swiggy", "ubereats", "deliveroo", "doordash", "google", "other"] as const;
export type MenuSourceType = (typeof MENU_SOURCE_TYPES)[number];

export const MENU_CHECK_STATUSES = ["clean", "flagged", "no_menu"] as const;
export type MenuCheckStatus = (typeof MENU_CHECK_STATUSES)[number];

export const MENU_FLAG_REASONS = ["alcohol", "pork", "other"] as const;
export type MenuFlagReason = (typeof MENU_FLAG_REASONS)[number];

export const MAX_MENU_ITEMS = 500;
export const MAX_MENU_SOURCES = 10;
export const MAX_MENU_FLAGS = 50;
export const MAX_ITEM_NAME = 160;
export const MAX_ITEM_DESCRIPTION = 500;
export const MAX_SECTION = 80;
export const MAX_FLAG_NOTE = 300;
/** No menu item costs this much in any currency's major unit; above it is a parsing slip. */
export const MAX_PRICE = 10_000_000;

/** The badge and its explanation. A clean menu check is a read of the published menu, nothing more. */
export const MENU_BADGE_LABEL = "Menu checked: no alcohol · no pork";
export const MENU_BADGE_TOOLTIP =
  "An automated read of the menu this place publishes found no alcohol or pork on it. It isn’t halal certification and it isn’t a community check.";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; message: string };

const fail = (error: string, message: string) => ({ ok: false as const, error, message });

/** ISO 4217 codes the runtime knows, when it can list them. */
let knownCurrencies: Set<string> | null | undefined;
function currencies(): Set<string> | null {
  if (knownCurrencies === undefined) {
    const list = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    try {
      knownCurrencies = typeof list === "function" ? new Set(list("currency")) : null;
    } catch {
      knownCurrencies = null;
    }
  }
  return knownCurrencies;
}

/** Three upper-case letters, and a code the runtime knows when it can say. */
export function isCurrencyCode(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return false;
  return currencies()?.has(value) ?? true;
}

/** A price in major units: finite, zero or more, rounded to 3 decimals (the most any currency uses). */
export function parsePrice(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PRICE) return null;
  return Math.round(value * 1000) / 1000;
}

const clean = (value: string | null | undefined, max: number): string | null => {
  const text = value?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? Array.from(text).slice(0, max).join("") : null;
};

/** A date Scout read something on: ISO date or date-time, not in the future, not before 2000. Absent means now. */
export function parseCapturedAt(value: string | undefined, now: number): Result<number> {
  if (value === undefined || value.trim() === "") return { ok: true, value: now };
  const text = value.trim();
  const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
  if (Number.isNaN(at)) return fail("invalid_date", "Dates are ISO dates, like 2026-10-18 or 2026-10-18T12:00:00Z.");
  if (at > now + 24 * 60 * 60 * 1000) return fail("invalid_date", "That date is in the future.");
  if (at < Date.UTC(2000, 0, 1)) return fail("invalid_date", "That date is too far back for a menu read.");
  return { ok: true, value: Math.min(at, now) };
}

export type MenuItemInput = { name: string; price: number; currency?: string; section?: string | null; description?: string | null };
export type MenuSourceInput = { url: string; type: string };

export type MenuItem = { position: number; section: string | null; name: string; description: string | null; price: number; currency: string };
export type MenuSource = { position: number; url: string; type: MenuSourceType };
export type Menu = { items: MenuItem[]; sources: MenuSource[] };

/**
 * Check and tidy a menu as Scout sends it. Items keep their order; each takes
 * the menu's currency unless it names its own. Duplicate source URLs collapse.
 */
export function normalizeMenu(input: { items: readonly MenuItemInput[]; sources: readonly MenuSourceInput[]; currency?: string }): Result<Menu> {
  if (input.currency !== undefined && !isCurrencyCode(input.currency))
    return fail("invalid_currency", `${String(input.currency)} isn't an ISO 4217 currency code. Send three capital letters, like GBP or INR.`);
  if (!input.items.length) return fail("empty_menu", "Send at least one item. A place with no menu online is set_menu_check with status no_menu.");
  if (input.items.length > MAX_MENU_ITEMS) return fail("too_many_items", `A menu holds at most ${MAX_MENU_ITEMS} items.`);
  if (!input.sources.length) return fail("missing_source", "Send at least one source: the https page the menu was read from.");
  if (input.sources.length > MAX_MENU_SOURCES) return fail("too_many_sources", `A menu cites at most ${MAX_MENU_SOURCES} sources.`);

  const sources: MenuSource[] = [];
  for (const source of input.sources) {
    const url = httpsSourceUrl(source.url);
    if (!url) return fail("invalid_source_url", "Menu sources must be https URLs (http is refused).");
    const type = MENU_SOURCE_TYPES.find((name) => name === source.type);
    if (!type) return fail("invalid_source_type", `Source types are ${MENU_SOURCE_TYPES.join(", ")}.`);
    if (!sources.some((seen) => seen.url === url)) sources.push({ position: sources.length, url, type });
  }

  const items: MenuItem[] = [];
  for (const [index, item] of input.items.entries()) {
    const name = clean(item.name, MAX_ITEM_NAME);
    if (!name) return fail("invalid_item", `Item ${index} has no name.`);
    const price = parsePrice(item.price);
    if (price === null) return fail("invalid_price", `Item ${index} (${name}): prices are numbers from 0 to ${MAX_PRICE}, in the currency's major unit (12.5 for £12.50).`);
    const currency = item.currency ?? input.currency;
    if (currency === undefined) return fail("invalid_currency", `Item ${index} (${name}) has no currency: send one on the item or the menu.`);
    if (!isCurrencyCode(currency))
      return fail("invalid_currency", `Item ${index} (${name}): ${currency} isn't an ISO 4217 currency code. Send three capital letters, like GBP or INR.`);
    items.push({
      position: index,
      section: clean(item.section, MAX_SECTION),
      name,
      description: clean(item.description, MAX_ITEM_DESCRIPTION),
      price,
      currency,
    });
  }
  return { ok: true, value: { items, sources } };
}

/** Same items and sources in the same order: a repeat upsert that changes nothing. */
export function sameMenu(a: Menu, b: Menu): boolean {
  const items = (menu: Menu) => menu.items.map(({ position, section, name, description, price, currency }) => [position, section, name, description, price, currency]);
  const sources = (menu: Menu) => menu.sources.map(({ position, url, type }) => [position, url, type]);
  return JSON.stringify([items(a), sources(a)]) === JSON.stringify([items(b), sources(b)]);
}

export type MenuSection<T extends Pick<MenuItem, "position" | "section">> = { section: string | null; items: T[] };

/** Items grouped by section, sections in the order their first item appears, items in menu order. */
export function groupMenuItems<T extends Pick<MenuItem, "position" | "section">>(items: readonly T[]): MenuSection<T>[] {
  const sections = new Map<string, MenuSection<T>>();
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    const key = (item.section ?? "").toLocaleLowerCase();
    const section = sections.get(key) ?? { section: item.section, items: [] };
    section.items.push(item);
    sections.set(key, section);
  }
  return [...sections.values()];
}

/** "£12.50", "₹250", "¥800": the currency's own symbol and decimals. Unknown codes fall back to "XYZ 12.5". */
export function formatMenuPrice(price: number, currency: string, locale = "en-GB"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

export type MenuFlagInput = { item?: string; name?: string; reason: string; note?: string | null };
export type MenuFlag = { position: number; itemPosition: number | null; itemName: string; reason: MenuFlagReason; note: string | null };

const itemKey = (name: string) => name.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/**
 * Check a menu check's status and flags. A flagged check needs at least one
 * flag and the others none. A flag's `item` must be the name of an item on
 * the stored menu (matched without case); `name` is for something the menu
 * shows that isn't a priced item (a drinks list, a footnote).
 */
export function normalizeMenuCheck(
  input: { status: string; flags?: readonly MenuFlagInput[]; sourceUrl?: string | null },
  menuItems: readonly Pick<MenuItem, "position" | "name">[],
): Result<{ status: MenuCheckStatus; flags: MenuFlag[]; sourceUrl: string | null }> {
  const status = MENU_CHECK_STATUSES.find((name) => name === input.status);
  if (!status) return fail("invalid_status", `Menu check statuses are ${MENU_CHECK_STATUSES.join(", ")}.`);
  const flagsIn = input.flags ?? [];
  if (status === "flagged" && !flagsIn.length) return fail("missing_flags", "A flagged check lists what it found: at least one flag.");
  if (status !== "flagged" && flagsIn.length) return fail("unexpected_flags", `A ${status} check has no flags. Use status flagged.`);
  if (flagsIn.length > MAX_MENU_FLAGS) return fail("too_many_flags", `A check lists at most ${MAX_MENU_FLAGS} flags.`);
  let sourceUrl: string | null = null;
  if (input.sourceUrl) {
    sourceUrl = httpsSourceUrl(input.sourceUrl);
    if (!sourceUrl) return fail("invalid_source_url", "source_url must be an https URL (http is refused).");
  }

  const byName = new Map<string, Pick<MenuItem, "position" | "name">>();
  for (const item of menuItems) if (!byName.has(itemKey(item.name))) byName.set(itemKey(item.name), item);
  const flags: MenuFlag[] = [];
  for (const [index, flag] of flagsIn.entries()) {
    const reason = MENU_FLAG_REASONS.find((name) => name === flag.reason);
    if (!reason) return fail("invalid_reason", `Flag ${index}: reasons are ${MENU_FLAG_REASONS.join(", ")}.`);
    if ((flag.item === undefined) === (flag.name === undefined))
      return fail("invalid_flag", `Flag ${index}: send item (the name of an item on the stored menu) or name (anything else), not both.`);
    let itemPosition: number | null = null;
    let itemName: string | null;
    if (flag.item !== undefined) {
      const match = byName.get(itemKey(flag.item));
      if (!match)
        return fail("unknown_item", `Flag ${index}: no item called "${clean(flag.item, MAX_ITEM_NAME) ?? ""}" is on this place's menu. Upsert the menu first, or send name instead of item.`);
      itemPosition = match.position;
      itemName = match.name;
    } else itemName = clean(flag.name, MAX_ITEM_NAME);
    if (!itemName) return fail("invalid_flag", `Flag ${index} has no name.`);
    flags.push({ position: index, itemPosition, itemName, reason, note: clean(flag.note, MAX_FLAG_NOTE) });
  }
  return { ok: true, value: { status, flags, sourceUrl } };
}

/**
 * The facts a menu check asks Scout to claim the place serves. Only a flagged
 * check asks, and only for alcohol and pork; a clean check never yields a
 * claim, so it can't set a fact to "no".
 */
export function menuCheckFacts(status: MenuCheckStatus, flags: readonly Pick<MenuFlag, "reason">[]): ("alcohol" | "pork")[] {
  if (status !== "flagged") return [];
  return (["alcohol", "pork"] as const).filter((fact) => flags.some((flag) => flag.reason === fact));
}

/** The badge shows for a clean check only: never for flagged, no_menu or no check. */
export function showsMenuBadge(check: { status: MenuCheckStatus } | null | undefined): boolean {
  return check?.status === "clean";
}

/** An https image URL for a logo, or null. Read and render both go through this. */
export function httpsLogoUrl(value: unknown): string | null {
  return typeof value === "string" ? httpsSourceUrl(value) : null;
}

export const MENU_SOURCE_LABEL: Record<MenuSourceType, string> = {
  website: "Website",
  zomato: "Zomato",
  swiggy: "Swiggy",
  ubereats: "Uber Eats",
  deliveroo: "Deliveroo",
  doordash: "DoorDash",
  google: "Google",
  other: "Web page",
};

/** Read a stored source type leniently. */
export function parseMenuSourceType(value: unknown): MenuSourceType {
  return MENU_SOURCE_TYPES.find((name) => name === value) ?? "other";
}

/** Read a stored check status leniently: anything unknown is no check at all. */
export function parseMenuCheckStatus(value: unknown): MenuCheckStatus | null {
  return MENU_CHECK_STATUSES.find((name) => name === value) ?? null;
}

/** Items a long menu shows before "Show all". */
export const MENU_PREVIEW_ITEMS = 10;

/**
 * Split grouped sections into what shows at once and what waits behind
 * "Show all": the first `limit` items in menu order. A section cut in two
 * carries on after the fold, marked `continued` so its heading isn't repeated.
 */
export function previewMenu<T>(sections: readonly { section: string | null; items: readonly T[] }[], limit = MENU_PREVIEW_ITEMS) {
  const shown: { section: string | null; items: T[] }[] = [];
  const rest: { section: string | null; items: T[]; continued: boolean }[] = [];
  let left = limit;
  for (const section of sections) {
    if (left > 0) {
      const head = section.items.slice(0, left);
      shown.push({ section: section.section, items: head });
      left -= head.length;
      if (section.items.length > head.length) rest.push({ section: section.section, items: section.items.slice(head.length), continued: true });
    } else rest.push({ section: section.section, items: [...section.items], continued: false });
  }
  return { shown, rest };
}
