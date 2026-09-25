/**
 * The wall between money and trust.
 *
 * The rule the product sells itself on is that payment cannot buy a halal
 * status, a confidence level or an organic position. That has to be
 * structural rather than a policy someone remembers: sponsored placements live
 * in their own table, the discovery query never joins it, and the helpers below
 * are the only way a sponsored row reaches a page — always labelled, always
 * outside the ranked list.
 */

export const TRANSACTION_ACTIONS = [
  "order",
  "book",
  "pickup",
  "directions",
  "menu",
  "call",
] as const;

export type TransactionAction = (typeof TRANSACTION_ACTIONS)[number];

export const TRANSACTION_COPY: Record<TransactionAction, string> = {
  order: "Order delivery",
  book: "Book a table",
  pickup: "Order pickup",
  directions: "Directions",
  menu: "Menu",
  call: "Call",
};

/** Actions that may earn the platform a commission, and must say so. */
export const COMMISSIONABLE: ReadonlySet<TransactionAction> = new Set([
  "order",
  "book",
  "pickup",
]);

export type SponsoredPlacement = {
  id: string;
  placeId: string;
  label: string;
  startsAt: number;
  endsAt: number;
};

export type PlacementSlot =
  | { kind: "organic"; placeId: string }
  | { kind: "sponsored"; placeId: string; label: string; disclosure: string };

export const SPONSORED_DISCLOSURE =
  "Paid placement. It does not affect halal status, confidence, or where this restaurant appears in the results below.";

/**
 * Attach sponsored slots to a page of organic results.
 *
 * Two invariants, both checked by the unit tests: the organic order is returned
 * byte-for-byte unchanged, and a sponsored place is never also emitted as an
 * organic row it did not earn. Sponsored slots come back as a separate list so
 * a caller cannot accidentally splice them into the ranking.
 */
export function attachSponsored(
  organicPlaceIds: readonly string[],
  placements: readonly SponsoredPlacement[],
  now: number = Date.now(),
): { organic: PlacementSlot[]; sponsored: PlacementSlot[] } {
  const live = placements.filter(
    (placement) => placement.startsAt <= now && placement.endsAt > now,
  );
  return {
    organic: organicPlaceIds.map((placeId) => ({
      kind: "organic" as const,
      placeId,
    })),
    sponsored: live.map((placement) => ({
      kind: "sponsored" as const,
      placeId: placement.placeId,
      label: placement.label,
      disclosure: SPONSORED_DISCLOSURE,
    })),
  };
}

/**
 * The inputs a ranking function is allowed to see.
 *
 * Passing a value through here is what makes "payment cannot change rank" a
 * property of the code rather than a promise: anything commercial is dropped
 * before the ranking layer can read it.
 */
export type RankingInput = Record<string, unknown>;

const COMMERCIAL_KEYS = [
  "sponsored",
  "sponsorship",
  "paid",
  "payment",
  "commission",
  "advertiser",
  "promoted",
  "bid",
  "budget",
  "subscriptionTier",
  "isPro",
];

export function stripCommercialSignals(input: RankingInput): RankingInput {
  const clean: RankingInput = {};
  for (const [key, value] of Object.entries(input)) {
    const lowered = key.toLowerCase();
    if (COMMERCIAL_KEYS.some((banned) => lowered.includes(banned.toLowerCase())))
      continue;
    clean[key] = value;
  }
  return clean;
}

/** True when a ranking input still carries something commercial. */
export function hasCommercialSignal(input: RankingInput): boolean {
  return Object.keys(input).length !== Object.keys(stripCommercialSignals(input)).length;
}

export type HandoffLink = {
  action: TransactionAction;
  url: string;
  provider: string;
  /** Shown next to the link whenever the platform may earn from it. */
  disclosure: string | null;
};

const SAFE_PROTOCOLS = ["http:", "https:", "tel:"];

/**
 * Build one outbound handoff. The product does not pretend to own the
 * transaction: it names the provider it is handing off to, and discloses when
 * it may earn from the referral.
 */
export function buildHandoff(
  action: TransactionAction,
  url: string | null,
  provider: string | null,
): HandoffLink | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!SAFE_PROTOCOLS.includes(parsed.protocol)) return null;
    return {
      action,
      url: parsed.href,
      provider: provider ?? parsed.hostname.replace(/^www\./, ""),
      disclosure: COMMISSIONABLE.has(action)
        ? "Referral link. We may earn a commission; it does not affect ranking."
        : null,
    };
  } catch {
    return null;
  }
}
