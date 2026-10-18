/** Coordinate provenance; unknown values are protected like a legacy NULL. */
export const LOCATION_SOURCES = ["scout", "geocoded", "google", "community", "import", "listing"] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

/** Validate stored or supplied provenance before using it. */
export function locationSource(value: unknown): LocationSource | null {
  return LOCATION_SOURCES.includes(value as LocationSource) ? value as LocationSource : null;
}
