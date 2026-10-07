/**
 * How wide a discovery viewport is allowed to be.
 *
 * Twenty degrees of latitude is a large region. Longitude allows a 60 km
 * nearby search: that box is about 108 degrees wide at the latitude where the
 * helper stops widening it, and a world box is still rejected.
 */
export const MAX_DISCOVERY_LAT_SPAN_DEGREES = 20;
export const MAX_DISCOVERY_LNG_SPAN_DEGREES = 120;

export type DiscoveryBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Longitude span, including a box that crosses the antimeridian. */
export function discoveryLngSpan(bbox: DiscoveryBbox): number {
  if (bbox.west <= bbox.east) return bbox.east - bbox.west;
  return 360 - bbox.west + bbox.east;
}

export function discoveryBboxExceedsCap(bbox: DiscoveryBbox): boolean {
  return (
    bbox.north - bbox.south > MAX_DISCOVERY_LAT_SPAN_DEGREES ||
    discoveryLngSpan(bbox) > MAX_DISCOVERY_LNG_SPAN_DEGREES
  );
}
