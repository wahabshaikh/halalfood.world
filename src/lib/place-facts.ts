/**
 * Independent factual attributes. The product deliberately never collapses
 * these into a single badge: alcohol, pork, shared kitchen, ownership, prayer
 * space and certification are separate facts, each with its own unknown state.
 */

export const FACT_KEYS = [
  "servesAlcohol",
  "servesPork",
  "dedicatedHalalKitchen",
  "muslimOwned",
  "prayerSpace",
  "womenFriendlyFacilities",
  "vegetarianOptions",
] as const;

export type FactKey = (typeof FACT_KEYS)[number];
export type FactValue = "yes" | "no" | "unknown";

export const FACT_COLUMNS: Record<FactKey, string> = {
  servesAlcohol: "serves_alcohol",
  servesPork: "serves_pork",
  dedicatedHalalKitchen: "dedicated_halal_kitchen",
  muslimOwned: "muslim_owned",
  prayerSpace: "prayer_space",
  womenFriendlyFacilities: "women_friendly_facilities",
  vegetarianOptions: "vegetarian_options",
};

export type FactCopy = {
  label: string;
  yes: string;
  no: string;
  unknown: string;
  /** Which answer the product treats as reassuring, for colour-independent UI. */
  reassuring: FactValue;
};

export const FACT_COPY: Record<FactKey, FactCopy> = {
  servesAlcohol: {
    label: "Alcohol",
    yes: "Serves alcohol",
    no: "No alcohol served",
    unknown: "Alcohol unknown",
    reassuring: "no",
  },
  servesPork: {
    label: "Pork",
    yes: "Pork on the menu",
    no: "No pork on the menu",
    unknown: "Pork unknown",
    reassuring: "no",
  },
  dedicatedHalalKitchen: {
    label: "Kitchen",
    yes: "Dedicated halal kitchen",
    no: "Shared kitchen",
    unknown: "Kitchen arrangement unknown",
    reassuring: "yes",
  },
  muslimOwned: {
    label: "Ownership",
    yes: "Muslim-owned",
    no: "Not Muslim-owned",
    unknown: "Ownership unknown",
    reassuring: "yes",
  },
  prayerSpace: {
    label: "Prayer space",
    yes: "Prayer space available",
    no: "No prayer space",
    unknown: "Prayer space unknown",
    reassuring: "yes",
  },
  womenFriendlyFacilities: {
    label: "Facilities",
    yes: "Women-friendly facilities",
    no: "No separate facilities",
    unknown: "Facilities unknown",
    reassuring: "yes",
  },
  vegetarianOptions: {
    label: "Vegetarian",
    yes: "Vegetarian options",
    no: "No vegetarian options",
    unknown: "Vegetarian options unknown",
    reassuring: "yes",
  },
};

export const SERVICE_TYPES = ["dine-in", "takeaway", "delivery", "drive-through"] as const;
export const MEALS = ["breakfast", "lunch", "dinner", "late-night"] as const;

export type PlaceFacts = {
  placeId: string;
  servesAlcohol: FactValue;
  servesPork: FactValue;
  dedicatedHalalKitchen: FactValue;
  muslimOwned: FactValue;
  prayerSpace: FactValue;
  womenFriendlyFacilities: FactValue;
  vegetarianOptions: FactValue;
  certificationBody: string | null;
  priceBand: number | null;
  serviceTypes: string[];
  meals: string[];
  neighbourhood: string | null;
  brandSlug: string | null;
  branchLabel: string | null;
  reservationUrl: string | null;
  deliveryUrl: string | null;
  menuUrl: string | null;
  updatedAt: number | null;
};

export function isFactValue(value: unknown): value is FactValue {
  return value === "yes" || value === "no" || value === "unknown";
}

export function emptyFacts(placeId: string): PlaceFacts {
  return {
    placeId,
    servesAlcohol: "unknown",
    servesPork: "unknown",
    dedicatedHalalKitchen: "unknown",
    muslimOwned: "unknown",
    prayerSpace: "unknown",
    womenFriendlyFacilities: "unknown",
    vegetarianOptions: "unknown",
    certificationBody: null,
    priceBand: null,
    serviceTypes: [],
    meals: [],
    neighbourhood: null,
    brandSlug: null,
    branchLabel: null,
    reservationUrl: null,
    deliveryUrl: null,
    menuUrl: null,
    updatedAt: null,
  };
}

function stringArray(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function factOf(row: Record<string, unknown>, column: string): FactValue {
  const value = row[column];
  return isFactValue(value) ? value : "unknown";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Map one `place_facts` row, tolerating a missing row entirely. */
export function mapPlaceFacts(
  placeId: string,
  row: Record<string, unknown> | null | undefined,
): PlaceFacts {
  if (!row) return emptyFacts(placeId);
  const priceBand = Number(row.price_band);
  return {
    placeId,
    servesAlcohol: factOf(row, "serves_alcohol"),
    servesPork: factOf(row, "serves_pork"),
    dedicatedHalalKitchen: factOf(row, "dedicated_halal_kitchen"),
    muslimOwned: factOf(row, "muslim_owned"),
    prayerSpace: factOf(row, "prayer_space"),
    womenFriendlyFacilities: factOf(row, "women_friendly_facilities"),
    vegetarianOptions: factOf(row, "vegetarian_options"),
    certificationBody: nullableText(row.certification_body),
    priceBand:
      Number.isInteger(priceBand) && priceBand >= 1 && priceBand <= 4
        ? priceBand
        : null,
    serviceTypes: stringArray(row.service_types),
    meals: stringArray(row.meals),
    neighbourhood: nullableText(row.neighbourhood),
    brandSlug: nullableText(row.brand_slug),
    branchLabel: nullableText(row.branch_label),
    reservationUrl: nullableText(row.reservation_url),
    deliveryUrl: nullableText(row.delivery_url),
    menuUrl: nullableText(row.menu_url),
    updatedAt:
      typeof row.updated_at === "number" && Number.isFinite(row.updated_at)
        ? row.updated_at
        : null,
  };
}

/** Facts worth showing as chips: known answers first, unknowns last. */
export function displayFacts(
  facts: PlaceFacts,
): Array<{ key: FactKey; value: FactValue; label: string; reassuring: boolean }> {
  return FACT_KEYS.map((key) => {
    const value = facts[key];
    const copy = FACT_COPY[key];
    return {
      key,
      value,
      label: copy[value],
      reassuring: value !== "unknown" && value === copy.reassuring,
    };
  }).sort((a, b) => {
    const rank = (value: FactValue) => (value === "unknown" ? 1 : 0);
    return rank(a.value) - rank(b.value);
  });
}

export function priceBandLabel(band: number | null): string | null {
  if (!band || band < 1 || band > 4) return null;
  return "$".repeat(band);
}
