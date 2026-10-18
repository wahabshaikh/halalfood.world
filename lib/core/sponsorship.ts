/**
 * City sponsorships: one sponsor at a time per city, paid monthly through Whop.
 *
 * A sponsorship is a labelled card on the city's Explore page and nothing else: it is not a place, it is
 * shown apart from the place list, and it never reaches lib/core/halal.ts or any ranking (spec §1 rule 9).
 * These are the pure rules: validating what a sponsor writes, who holds a city, the paid window, and
 * reading Whop webhook payloads. I/O lives in lib/sponsorships.ts and lib/whop.ts.
 */
import { citySlugParam } from "./params";

const DAY = 24 * 60 * 60 * 1000;

/** Price per city per month, in US dollars. Whop charges this; the pages show it. */
export const SPONSOR_PRICE_USD = 49;
/** One billing period. Whop renews the membership every this many days. */
export const SPONSOR_PERIOD_DAYS = 30;
const PERIOD_MS = SPONSOR_PERIOD_DAYS * DAY;
/** A started checkout holds the city this long, so two buyers can't pay for the same month. */
export const CHECKOUT_HOLD_MS = 60 * 60 * 1000;
/** A renewing sponsor keeps the city this long past `active_until`, while Whop retries the renewal. */
export const RENEWAL_GRACE_MS = 3 * DAY;

export const MAX_SPONSOR_NAME = 60;
export const MAX_TAGLINE = 120;
export const MAX_LINK_URL = 300;

export type SponsorStatus = "pending" | "active" | "refunded" | "removed";

export type SponsorInput = { citySlug: string; name: string; tagline: string | null; linkUrl: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The https link a sponsor card points to, or null. No credentials, no other schemes. */
export function sponsorLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LINK_URL) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.href.length <= MAX_LINK_URL ? url.href : null;
  } catch {
    return null;
  }
}

/** Collapse whitespace and drop control characters, so a card can't be stretched or spoofed. */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const printable = Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("");
  return printable.replace(/\s+/g, " ").trim();
}

/** Body `{citySlug, name, tagline?, linkUrl}` from the sponsor form. */
export function parseSponsorInput(body: unknown): Parsed<SponsorInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a valid JSON object." };
  const raw = body as Record<string, unknown>;
  const citySlug = citySlugParam(typeof raw.citySlug === "string" ? raw.citySlug : null);
  if (!citySlug) return { ok: false, error: "Choose a city to sponsor." };
  const name = cleanText(raw.name);
  if (!name) return { ok: false, error: "Add the name to show on the card." };
  if (name.length > MAX_SPONSOR_NAME) return { ok: false, error: `Keep the name under ${MAX_SPONSOR_NAME} characters.` };
  const tagline = cleanText(raw.tagline);
  if (tagline.length > MAX_TAGLINE) return { ok: false, error: `Keep the line under ${MAX_TAGLINE} characters.` };
  const linkUrl = sponsorLink(typeof raw.linkUrl === "string" ? raw.linkUrl : "");
  if (!linkUrl) return { ok: false, error: "Add the https link people should visit." };
  return { ok: true, value: { citySlug, name, tagline: tagline || null, linkUrl } };
}

export type SponsorshipState = {
  id: string;
  userId: string | null;
  status: SponsorStatus;
  renews: boolean;
  startsAt: number | null;
  activeUntil: number | null;
  createdAt: number;
};

/** Shown on the city page right now. */
export function isLive(row: SponsorshipState, now: number): boolean {
  return row.status === "active" && row.startsAt !== null && row.activeUntil !== null && row.startsAt <= now && now < row.activeUntil;
}

/** Until when this row keeps anyone else from buying the city, or null when it doesn't. */
export function holdUntil(row: SponsorshipState, now: number): number | null {
  if (row.status === "pending") {
    const until = row.createdAt + CHECKOUT_HOLD_MS;
    return until > now ? until : null;
  }
  if (row.status === "active" && row.activeUntil !== null) {
    const until = row.activeUntil + (row.renews ? RENEWAL_GRACE_MS : 0);
    return until > now ? until : null;
  }
  return null;
}

export type CityAvailability =
  | { open: true }
  | { open: false; reason: "sponsored"; until: number; renews: boolean }
  | { open: false; reason: "held"; until: number };

/**
 * Whether `viewerId` can start a checkout for the city. Their own pending checkouts don't block them;
 * a paid sponsorship blocks everyone, its buyer included (they manage renewal in Whop).
 */
export function cityAvailability(rows: SponsorshipState[], now: number, viewerId: string | null): CityAvailability {
  let sponsored: { until: number; renews: boolean } | null = null;
  let held: number | null = null;
  for (const row of rows) {
    const until = holdUntil(row, now);
    if (until === null) continue;
    if (row.status === "active") {
      if (!sponsored || until > sponsored.until) sponsored = { until: row.activeUntil ?? until, renews: row.renews };
    } else if (row.userId !== viewerId) {
      held = Math.max(held ?? 0, until);
    }
  }
  if (sponsored) return { open: false, reason: "sponsored", ...sponsored };
  if (held !== null) return { open: false, reason: "held", until: held };
  return { open: true };
}

/**
 * The window a payment buys. A renewal extends the row's own window by one period. A first payment
 * starts now, or when another paid sponsor's window in the same city ends, so two cards never show at
 * once even if a payment lands after its checkout hold ran out.
 */
export function paidWindow(row: SponsorshipState, others: SponsorshipState[], paidAt: number): { startsAt: number; activeUntil: number } {
  if (row.status === "active" && row.startsAt !== null && row.activeUntil !== null)
    return { startsAt: row.startsAt, activeUntil: Math.max(row.activeUntil, paidAt) + PERIOD_MS };
  let startsAt = paidAt;
  for (const other of others)
    if (other.id !== row.id && other.status === "active" && other.activeUntil !== null && other.activeUntil > startsAt)
      startsAt = other.activeUntil;
  return { startsAt, activeUntil: startsAt + PERIOD_MS };
}

/* ------------------------------------------------------------------------ */
/* Whop webhooks                                                             */
/* ------------------------------------------------------------------------ */

/** The Whop events this app acts on, reduced to what the handler needs. */
export type WhopEvent =
  | { type: "payment.succeeded"; paymentId: string; sponsorshipId: string | null; checkoutId: string | null; membershipId: string | null; paidAt: number }
  | { type: "membership.deactivated" | "membership.renewing"; membershipId: string; sponsorshipId: string | null }
  | { type: "refund"; paymentId: string | null; membershipId: string | null }
  | { type: "ignored"; name: string };

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

function time(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a verified Whop webhook body. Anything unexpected becomes `ignored`, never an error Whop retries. */
export function parseWhopEvent(body: unknown, now: number): WhopEvent {
  const event = obj(body);
  const name = str(event.type) ?? "unknown";
  const data = obj(event.data);
  if (name === "payment.succeeded") {
    const paymentId = str(data.id);
    if (!paymentId || obj(data.metadata).kind === "newsletter") return { type: "ignored", name };
    return {
      type: name,
      paymentId,
      sponsorshipId: str(obj(data.metadata).sponsorship_id),
      checkoutId: str(data.checkout_configuration_id),
      membershipId: str(obj(data.membership).id) ?? str(data.membership_id),
      paidAt: time(data.paid_at, time(event.timestamp, now)),
    };
  }
  if (["membership.activated", "membership.updated", "membership.deactivated", "membership.cancel_at_period_end_changed"].includes(name)) {
    const membershipId = str(data.id);
    if (!membershipId) return { type: "ignored", name };
    if (obj(data.metadata).kind === "newsletter") return { type: "ignored", name };
    const status = str(data.status);
    const stop = name === "membership.deactivated" || ["canceled", "completed", "expired", "unresolved"].includes(status ?? "") || data.cancel_at_period_end === true;
    const resume = (status === "active" || status === "trialing") && data.cancel_at_period_end === false;
    if (!stop && !resume) return { type: "ignored", name };
    return { type: stop ? "membership.deactivated" : "membership.renewing", membershipId, sponsorshipId: str(obj(data.metadata).sponsorship_id) };
  }
  if (name === "refund.created" || name === "refund.updated") {
    // Act once the money has gone back; a pending refund arrives again as refund.updated.
    const status = str(data.status);
    if (status && status !== "succeeded") return { type: "ignored", name };
    const payment = obj(data.payment);
    const paymentId = str(data.payment_id) ?? str(payment.id);
    const membershipId = str(obj(payment.membership).id);
    if (!paymentId && !membershipId) return { type: "ignored", name };
    return { type: "refund", paymentId, membershipId };
  }
  return { type: "ignored", name };
}
