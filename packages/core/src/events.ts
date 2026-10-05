/**
 * Halal food events: iftar walks, Eid markets and food festivals.
 *
 * A festival being "halal" is not one fact, so every vendor carries its own
 * status. A vendor linked to a listed place shows that place's evidence-based
 * status; a vendor with no listing shows "Unverified", which means only that
 * nobody has checked it here. It never means the stall is not halal, and the
 * copy below never says so. RSVPs and friends going are taste and planning, and
 * cannot change a status.
 */

import { STATUS_COPY, type HalalTaxonomyStatus, type StatusCopy } from "./halal-taxonomy";

export const MAX_EVENT_TITLE = 80;
export const MAX_EVENT_DESCRIPTION = 600;
export const MAX_EVENT_VENDORS = 200;
export const MAX_VENDOR_NAME = 80;
export const MAX_VENDOR_NOTE = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EventVendorInput = {
  name: string;
  /** What they sell, in a few words: "Malpua, phirni". */
  note: string | null;
  /** The listed place whose status this vendor shows, when there is one. */
  placeId: string | null;
};

export type EventInput = {
  title: string;
  description: string | null;
  citySlug: string;
  venue: string;
  address: string | null;
  startsAt: number;
  endsAt: number | null;
  vendors: EventVendorInput[];
};

export type EventValidation = { ok: true; event: EventInput } | { ok: false; error: string };

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function timestamp(value: unknown): number | null {
  const time =
    typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
}

/** An event runs at most a fortnight, which covers a festival and stops typos. */
export const MAX_EVENT_SPAN_MS = 14 * 24 * 60 * 60 * 1000;

export function validateEvent(input: unknown): EventValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  const title = clean(body.title, MAX_EVENT_TITLE);
  if (!title) return { ok: false, error: `Give the event a title of up to ${MAX_EVENT_TITLE} characters.` };
  const venue = clean(body.venue, 120);
  if (!venue) return { ok: false, error: "Say where it is." };

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null && body.description !== "") {
    description =
      typeof body.description === "string" && body.description.trim().length <= MAX_EVENT_DESCRIPTION
        ? body.description.replace(/\r\n?/g, "\n").trim()
        : null;
    if (description === null)
      return { ok: false, error: `The description can be up to ${MAX_EVENT_DESCRIPTION} characters.` };
  }

  const citySlug = typeof body.citySlug === "string" ? body.citySlug.trim().toLowerCase() : "";
  if (!SLUG.test(citySlug)) return { ok: false, error: "Pick a city." };

  const startsAt = timestamp(body.startsAt);
  if (startsAt === null) return { ok: false, error: "Say when it starts." };
  const endsAt = body.endsAt === undefined || body.endsAt === null ? null : timestamp(body.endsAt);
  if (body.endsAt !== undefined && body.endsAt !== null && endsAt === null)
    return { ok: false, error: "That end time is not valid." };
  if (endsAt !== null && (endsAt < startsAt || endsAt - startsAt > MAX_EVENT_SPAN_MS))
    return { ok: false, error: "An event ends after it starts, within two weeks." };

  const address = body.address === undefined || body.address === null ? null : clean(body.address, 200);

  const rawVendors = body.vendors === undefined ? [] : body.vendors;
  if (!Array.isArray(rawVendors)) return { ok: false, error: "Vendors must be a list." };
  if (rawVendors.length > MAX_EVENT_VENDORS)
    return { ok: false, error: `An event can list up to ${MAX_EVENT_VENDORS} vendors.` };
  const vendors: EventVendorInput[] = [];
  for (const raw of rawVendors) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { ok: false, error: "Each vendor needs a name." };
    const vendor = raw as Record<string, unknown>;
    const name = clean(vendor.name, MAX_VENDOR_NAME);
    if (!name) return { ok: false, error: "Each vendor needs a name." };
    const note =
      vendor.note === undefined || vendor.note === null || vendor.note === ""
        ? null
        : clean(vendor.note, MAX_VENDOR_NOTE);
    if (vendor.note && note === null)
      return { ok: false, error: `Vendor notes can be up to ${MAX_VENDOR_NOTE} characters.` };
    const placeId =
      vendor.placeId === undefined || vendor.placeId === null || vendor.placeId === ""
        ? null
        : String(vendor.placeId);
    if (placeId !== null && !UUID.test(placeId))
      return { ok: false, error: "A vendor’s place id is not valid." };
    vendors.push({ name, note, placeId });
  }

  return {
    ok: true,
    event: {
      title,
      description,
      citySlug,
      venue,
      address,
      startsAt,
      endsAt,
      vendors,
    },
  };
}

export type EventPhase = "upcoming" | "live" | "past";

/** Where an event stands. With no end time it runs for six hours from the start. */
export function eventPhase(
  event: { startsAt: number; endsAt: number | null },
  now: number,
): EventPhase {
  const end = event.endsAt ?? event.startsAt + 6 * 60 * 60 * 1000;
  if (now < event.startsAt) return "upcoming";
  return now <= end ? "live" : "past";
}

/** What a vendor row says about halal status. */
export type VendorStatusView = {
  label: string;
  tone: StatusCopy["tone"];
  /** True when the status comes from a listed place's evidence. */
  listed: boolean;
  note: string;
};

const UNLISTED_NOTE =
  "No listing yet, so nobody has checked this stall here. That says nothing either way.";

/**
 * The status shown beside a vendor. `status` is the assessed status of the
 * linked place, or undefined for a vendor with no listing. An unlisted vendor
 * is labelled "Unverified" and told apart from a place that is actually marked
 * not halal.
 */
export function vendorStatusView(status: HalalTaxonomyStatus | undefined): VendorStatusView {
  const copy = STATUS_COPY[status ?? "unverified"];
  return {
    label: copy.label,
    tone: copy.tone,
    listed: status !== undefined,
    note: status ? "" : UNLISTED_NOTE,
  };
}

/** "Zaid, Hafsa and 64 others going". Friends first, then the rest of the count. */
export function goingLine(
  friends: readonly { handle: string; displayName: string | null }[],
  total: number,
): string | null {
  if (total <= 0) return null;
  const first = (person: { handle: string; displayName: string | null }) =>
    person.displayName?.trim().split(/\s+/)[0] || `@${person.handle}`;
  const named = friends.slice(0, 2).map(first);
  const rest = Math.max(total - named.length, 0);
  if (!named.length) return `${total} going`;
  if (!rest) return `${named.join(" and ")} going`;
  return `${named.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"} going`;
}

export function isEventId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
