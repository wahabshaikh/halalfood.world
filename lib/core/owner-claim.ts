/**
 * Paid restaurant claims. A restaurant can pay to manage its own hours, menu and photos,
 * upload a certificate for review, and appear in a labelled Sponsored block on its city page.
 *
 * Payment never reaches lib/core/halal.ts. The public "Claimed by the restaurant" line and the
 * Sponsored block wait for a moderator. Hours, menus and view counts are not halal evidence.
 * Checkout stays off until WHOP_OWNER_PLAN_ID is set (lib/whop.ts).
 */
import { placeIdParam } from "./params";
import { MAX_ITEM_DESCRIPTION, MAX_ITEM_NAME, MAX_SECTION, isCurrencyCode, parsePrice } from "./menus";

const DAY = 24 * 60 * 60 * 1000;

/** Shown on /claim. The Whop plan Wahab creates has to charge this amount. */
export const OWNER_CLAIM_PRICE_USD = 29;
/** One billing period. Whop renews the membership every this many days. */
export const OWNER_CLAIM_PERIOD_DAYS = 30;
const PERIOD_MS = OWNER_CLAIM_PERIOD_DAYS * DAY;
/** A started checkout holds the restaurant this long, so two buyers can't pay for it at once. */
export const CLAIM_HOLD_MS = 60 * 60 * 1000;
/** A renewing claim keeps the restaurant this long past `active_until`, while Whop retries. */
export const CLAIM_RENEWAL_GRACE_MS = 3 * DAY;
/** Sponsored restaurants on one city page. The rest of a city's claims keep their tools, not the block. */
export const FEATURED_PER_CITY = 4;
export const MAX_OWNER_MENU_ITEMS = 80;
export const MAX_HOURS_NOTE = 160;
export const MAX_CONTACT_EMAIL = 120;
export const MAX_CERTIFIER = 120;
export const MAX_OWNER_PHONE = 32;
export const MAX_OWNER_WEBSITE = 300;
export const MAX_OWNER_DESCRIPTION = 400;
/** Schemes a restaurant website may use. Anything else, including javascript: and data:, is refused. */
export const OWNER_WEBSITE_SCHEMES = ["http:", "https:"] as const;
/** Owner analytics window. Counts are approximate, never a bill. */
export const VIEW_DAYS = 30;

export const CLAIM_BADGE_LABEL = "Claimed by the restaurant";
export const CLAIM_BADGE_NOTE =
  "The restaurant pays to keep its own hours, menu and photos here. This is not Community verified, and it does not change halal facts.";
export const SPONSORED_SECTION_TITLE = "Sponsored";
export const SPONSORED_SECTION_NOTE =
  "Restaurants pay to appear in this block. It sits apart from the list below and does not change halal status or where a place ranks.";

export type ClaimRole = "owner" | "manager";
export type ClaimStatus = "pending" | "active" | "refunded" | "removed" | "ended";
export type ClaimReview = "pending" | "approved" | "rejected";
export type ModerateClaimAction = "approve" | "reject" | "remove" | "restore";

export type ClaimState = {
  id: string;
  userId: string | null;
  status: ClaimStatus;
  review: ClaimReview;
  renews: boolean;
  startsAt: number | null;
  activeUntil: number | null;
  createdAt: number;
};

export type DayHours = {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  closed: boolean;
  open: string | null;
  close: string | null;
};

export type OwnerMenuItemInput = {
  section: string | null;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const printable = Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("");
  return printable.replace(/\s+/g, " ").trim();
}

/** Paid window is open. Editing is allowed. The public label still needs a moderator. */
export function isPaidLive(row: ClaimState, now: number): boolean {
  return row.status === "active" && row.startsAt !== null && row.activeUntil !== null && row.startsAt <= now && now < row.activeUntil;
}

/** Shown on the place page and eligible for the city's Sponsored block. */
export function isPublicClaim(row: ClaimState, now: number): boolean {
  return isPaidLive(row, now) && row.review === "approved";
}

/** Until when this row keeps another buyer from starting a claim, or null when it doesn't. */
export function claimHoldUntil(row: ClaimState, now: number): number | null {
  if (row.status === "pending") {
    const until = row.createdAt + CLAIM_HOLD_MS;
    return until > now ? until : null;
  }
  if (row.status === "active" && row.activeUntil !== null) {
    const until = row.activeUntil + (row.renews ? CLAIM_RENEWAL_GRACE_MS : 0);
    return until > now ? until : null;
  }
  return null;
}

/**
 * The window a payment buys. A repeat of the same payment must not call this again: the caller
 * skips when `whop_payment_id` already matches. A renewal extends the row's own window.
 */
export function claimPaidWindow(row: ClaimState, paidAt: number): { startsAt: number; activeUntil: number } {
  if (row.status === "active" && row.startsAt !== null && row.activeUntil !== null) {
    return { startsAt: row.startsAt, activeUntil: Math.max(row.activeUntil, paidAt) + PERIOD_MS };
  }
  return { startsAt: paidAt, activeUntil: paidAt + PERIOD_MS };
}

export type ClaimCheckoutInput = { placeId: string; role: ClaimRole; contactEmail: string };

/** Body `{placeId, role, contactEmail}` from the claim form. */
export function parseClaimCheckout(body: unknown): Parsed<ClaimCheckoutInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a valid JSON object." };
  const raw = body as Record<string, unknown>;
  const placeId = placeIdParam(typeof raw.placeId === "string" ? raw.placeId : null);
  if (!placeId) return { ok: false, error: "Choose a restaurant to claim." };
  if (raw.role !== "owner" && raw.role !== "manager") return { ok: false, error: "Say whether you own the restaurant or manage it." };
  const contactEmail = cleanText(raw.contactEmail).toLowerCase();
  if (!contactEmail || contactEmail.length > MAX_CONTACT_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: "Add a contact email for this restaurant." };
  }
  return { ok: true, value: { placeId, role: raw.role, contactEmail } };
}

/** Seven days, Monday first. Close is later the same day. */
export function parseOwnerHours(body: unknown): Parsed<{ week: DayHours[]; note: string | null }> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a valid JSON object." };
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.week) || raw.week.length !== 7) return { ok: false, error: "Send hours for all seven days." };
  const week: DayHours[] = [];
  for (let day = 0; day < 7; day += 1) {
    const entry = raw.week[day];
    if (!entry || typeof entry !== "object") return { ok: false, error: "Send hours for all seven days." };
    const row = entry as Record<string, unknown>;
    if (row.day !== day) return { ok: false, error: "Send the days in order, Monday first." };
    if (row.closed === true) {
      week.push({ day: day as DayHours["day"], closed: true, open: null, close: null });
      continue;
    }
    if (row.closed !== false) return { ok: false, error: "Say whether each day is open or closed." };
    const open = typeof row.open === "string" ? row.open : "";
    const close = typeof row.close === "string" ? row.close : "";
    if (!TIME.test(open) || !TIME.test(close) || close <= open) {
      return { ok: false, error: `Set an opening and a later closing time for ${DAY_LABELS[day]}.` };
    }
    week.push({ day: day as DayHours["day"], closed: false, open, close });
  }
  const note = cleanText(raw.note);
  if (note.length > MAX_HOURS_NOTE) return { ok: false, error: `Keep the hours note under ${MAX_HOURS_NOTE} characters.` };
  return { ok: true, value: { week, note: note || null } };
}

/** Replace the restaurant's own menu. Prices are optional. This is not a halal check. */
export function parseOwnerMenu(body: unknown): Parsed<OwnerMenuItemInput[]> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a valid JSON object." };
  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items)) return { ok: false, error: "Send the menu as a list of dishes." };
  if (items.length > MAX_OWNER_MENU_ITEMS) return { ok: false, error: `Keep the menu to ${MAX_OWNER_MENU_ITEMS} dishes.` };
  const parsed: OwnerMenuItemInput[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return { ok: false, error: "Each dish needs a name." };
    const row = item as Record<string, unknown>;
    const name = cleanText(row.name);
    if (!name || name.length > MAX_ITEM_NAME) return { ok: false, error: `Each dish name needs 1–${MAX_ITEM_NAME} characters.` };
    const section = cleanText(row.section);
    if (section.length > MAX_SECTION) return { ok: false, error: `Keep section names under ${MAX_SECTION} characters.` };
    const description = cleanText(row.description);
    if (description.length > MAX_ITEM_DESCRIPTION) return { ok: false, error: `Keep dish descriptions under ${MAX_ITEM_DESCRIPTION} characters.` };
    let price: number | null = null;
    if (row.price !== null && row.price !== undefined && row.price !== "") {
      const value = parsePrice(row.price);
      if (value === null) return { ok: false, error: `“${name}” needs a price of zero or more, or no price.` };
      price = value;
    }
    const currency = typeof row.currency === "string" && row.currency ? row.currency.toUpperCase() : "USD";
    if (!isCurrencyCode(currency)) return { ok: false, error: `“${name}” needs a three-letter currency code.` };
    parsed.push({ section: section || null, name, description: description || null, price, currency });
  }
  return { ok: true, value: parsed };
}

export type OwnerDetailsInput = {
  phone: string | null;
  website: string | null;
  description: string | null;
};

/** Drop tags and comments. Tags cannot contain `<`, so a nested `<scr<script>ipt>` is peeled until none remain. */
export function stripHtml(value: string): string {
  let text = value.replace(/<!--[\s\S]*?-->/g, " ");
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, " ");
  }
  return text.replace(/[<>]/g, " ");
}

function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return cleanText(stripHtml(value));
}

/** Empty clears the number. Digits, spaces, dots, hyphens, parentheses, and one leading +. */
export function parseOwnerPhone(value: unknown): Parsed<string | null> {
  const text = plain(value);
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_OWNER_PHONE) return { ok: false, error: `Keep the phone number under ${MAX_OWNER_PHONE} characters.` };
  const pluses = text.match(/\+/g)?.length ?? 0;
  if (!/^\+?[0-9\s().-]+$/.test(text) || pluses > 1 || (pluses === 1 && !text.startsWith("+"))) {
    return { ok: false, error: "Use digits, spaces and a leading + for the phone number." };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return { ok: false, error: "Enter a phone number with 7 to 15 digits." };
  return { ok: true, value: text };
}

/** Empty clears the link. Only http and https, with no username or password in the URL. */
export function parseOwnerWebsite(value: unknown): Parsed<string | null> {
  const text = plain(value);
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_OWNER_WEBSITE) return { ok: false, error: `Keep the website under ${MAX_OWNER_WEBSITE} characters.` };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "Websites start with http:// or https://." };
  }
  if (!OWNER_WEBSITE_SCHEMES.includes(url.protocol as (typeof OWNER_WEBSITE_SCHEMES)[number])) {
    return { ok: false, error: "Websites start with http:// or https://." };
  }
  if (url.username || url.password || !url.hostname.includes(".")) {
    return { ok: false, error: "That website address is not usable." };
  }
  if (url.href.length > MAX_OWNER_WEBSITE) return { ok: false, error: `Keep the website under ${MAX_OWNER_WEBSITE} characters.` };
  return { ok: true, value: url.href };
}

/** Empty clears the text. Tags are removed; the length limit applies after that. */
export function parseOwnerDescription(value: unknown): Parsed<string | null> {
  const text = plain(value);
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_OWNER_DESCRIPTION) return { ok: false, error: `Keep the description under ${MAX_OWNER_DESCRIPTION} characters.` };
  return { ok: true, value: text };
}

/** Body `{phone, website, description}` from the claim page. Any field may be blank. */
export function parseOwnerDetails(body: unknown): Parsed<OwnerDetailsInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a valid JSON object." };
  const raw = body as Record<string, unknown>;
  const phone = parseOwnerPhone(raw.phone);
  if (!phone.ok) return phone;
  const website = parseOwnerWebsite(raw.website);
  if (!website.ok) return website;
  const description = parseOwnerDescription(raw.description);
  if (!description.ok) return description;
  return { ok: true, value: { phone: phone.value, website: website.value, description: description.value } };
}

/** "Monday · 11:00–22:00" or "Monday · Closed". */
export function formatDayHours(day: DayHours): string {
  const label = DAY_LABELS[day.day];
  if (day.closed || !day.open || !day.close) return `${label} · Closed`;
  return `${label} · ${day.open}–${day.close}`;
}

/** Read hours JSON written by parseOwnerHours. Anything else is treated as unset. */
export function readOwnerHours(value: unknown): DayHours[] | null {
  const parsed = parseOwnerHours({ week: value, note: null });
  return parsed.ok ? parsed.value.week : null;
}

export function parseCertifier(value: unknown): Parsed<string | null> {
  const text = cleanText(value);
  if (text.length > MAX_CERTIFIER) return { ok: false, error: `Keep the certifier under ${MAX_CERTIFIER} characters.` };
  return { ok: true, value: text || null };
}

/** YYYY-MM-DD expiry, good through that UTC day, or null when omitted. */
export function parseExpiry(value: unknown, now: number): Parsed<number | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: "Write the expiry date as YYYY-MM-DD." };
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return { ok: false, error: "Write the expiry date as YYYY-MM-DD." };
  const expiresAt = parsed + DAY;
  if (expiresAt <= now) return { ok: false, error: "That certificate has already expired." };
  return { ok: true, value: expiresAt };
}

export function parseModerateClaimAction(value: unknown): Parsed<ModerateClaimAction> {
  if (value === "approve" || value === "reject" || value === "remove" || value === "restore") return { ok: true, value };
  return { ok: false, error: "Choose approve, reject, remove or restore." };
}

/**
 * What a moderator is allowed to do. Approve and reject only change the public label.
 * Remove hides a paid claim. Restore puts a removed claim back. None of these write halal facts.
 */
export function moderateClaimTransition(
  row: Pick<ClaimState, "status" | "review">,
  action: ModerateClaimAction,
): Parsed<{ status: ClaimStatus; review: ClaimReview }> {
  if (action === "approve") {
    if (row.status !== "active") return { ok: false, error: "Only a paid claim can be approved." };
    if (row.review === "approved") return { ok: false, error: "That claim is already approved." };
    return { ok: true, value: { status: "active", review: "approved" } };
  }
  if (action === "reject") {
    if (row.status !== "active") return { ok: false, error: "Only a paid claim can be declined." };
    if (row.review === "rejected") return { ok: false, error: "That claim is already declined." };
    return { ok: true, value: { status: "active", review: "rejected" } };
  }
  if (action === "remove") {
    if (row.status !== "active") return { ok: false, error: "That claim is not live." };
    return { ok: true, value: { status: "removed", review: row.review } };
  }
  if (row.status !== "removed") return { ok: false, error: "That claim was not removed." };
  return { ok: true, value: { status: "active", review: row.review } };
}

export type ViewDay = { day: string; views: number };

/** UTC day key, YYYY-MM-DD. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Last `days` UTC days ending today, zeros where nobody was counted. */
export function fillViewDays(rows: readonly ViewDay[], now: number, days = VIEW_DAYS): ViewDay[] {
  const counts = new Map(rows.map((row) => [row.day, row.views]));
  const out: ViewDay[] = [];
  const start = Date.parse(`${utcDay(now)}T00:00:00Z`);
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(start - index * DAY).toISOString().slice(0, 10);
    const views = counts.get(day) ?? 0;
    out.push({ day, views: Number.isFinite(views) && views > 0 ? Math.floor(views) : 0 });
  }
  return out;
}

export function totalViews(rows: readonly ViewDay[]): number {
  return rows.reduce((sum, row) => sum + (row.views > 0 ? row.views : 0), 0);
}

/* ------------------------------------------------------------------------ */
/* Whop webhooks                                                             */
/* ------------------------------------------------------------------------ */

export type OwnerClaimEvent =
  | { type: "payment.succeeded"; paymentId: string; claimId: string | null; checkoutId: string | null; membershipId: string | null; paidAt: number }
  | { type: "membership.deactivated" | "membership.renewing"; membershipId: string; claimId: string | null }
  | { type: "refund"; paymentId: string | null; membershipId: string | null };

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

function time(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read a verified Whop body when it belongs to a restaurant claim. Anything else is null, so the
 * sponsorship and newsletter handlers keep the event. Refunds without a kind still return, and the
 * database update matches only `owner_claims` payment ids.
 */
export function parseOwnerClaimEvent(body: unknown, now: number): OwnerClaimEvent | null {
  const event = obj(body);
  const name = str(event.type) ?? "";
  const data = obj(event.data);
  const metadata = obj(data.metadata);
  if (name === "payment.succeeded") {
    if (metadata.kind !== "owner_claim") return null;
    const paymentId = str(data.id);
    if (!paymentId) return null;
    return {
      type: name,
      paymentId,
      claimId: str(metadata.claim_id),
      checkoutId: str(data.checkout_configuration_id),
      membershipId: str(obj(data.membership).id) ?? str(data.membership_id),
      paidAt: time(data.paid_at, time(event.timestamp, now)),
    };
  }
  if (["membership.activated", "membership.updated", "membership.deactivated", "membership.cancel_at_period_end_changed"].includes(name)) {
    if (metadata.kind !== "owner_claim") return null;
    const membershipId = str(data.id);
    if (!membershipId) return null;
    const status = str(data.status);
    const stop = name === "membership.deactivated" || ["canceled", "completed", "expired", "unresolved"].includes(status ?? "") || data.cancel_at_period_end === true;
    const resume = (status === "active" || status === "trialing") && data.cancel_at_period_end === false;
    if (!stop && !resume) return null;
    return { type: stop ? "membership.deactivated" : "membership.renewing", membershipId, claimId: str(metadata.claim_id) };
  }
  if (name === "refund.created" || name === "refund.updated") {
    const payment = obj(data.payment);
    const kind = str(metadata.kind) ?? str(obj(payment.metadata).kind);
    if (kind && kind !== "owner_claim") return null;
    const status = str(data.status);
    if (status && status !== "succeeded") return null;
    const paymentId = str(data.payment_id) ?? str(payment.id);
    const membershipId = str(obj(payment.membership).id) ?? str(data.membership_id);
    if (!paymentId && !membershipId) return null;
    return { type: "refund", paymentId, membershipId };
  }
  return null;
}
