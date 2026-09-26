/**
 * Where the visitor probably is, from Cloudflare's IP geolocation.
 *
 * The proxy copies `request.cf` onto request headers so server components can
 * read it through `headers()`. It is approximate (city level at best) and is
 * only ever used to choose what to show first — never stored, never trusted
 * for anything that matters.
 */

export type VisitorLocation = {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
};

/** Headers the proxy sets. Incoming copies are always stripped first. */
export const VISITOR_HEADERS = {
  lat: "x-visitor-lat",
  lng: "x-visitor-lng",
  city: "x-visitor-city",
  region: "x-visitor-region",
  country: "x-visitor-country",
} as const;

function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed || null;
}

function decode(value: string | null): string | null {
  if (!value) return null;
  try {
    return label(decodeURIComponent(value));
  } catch {
    return label(value);
  }
}

function build(parts: {
  lat: unknown;
  lng: unknown;
  city: unknown;
  region: unknown;
  country: unknown;
}): VisitorLocation | null {
  const lat = coordinate(parts.lat, 90);
  const lng = coordinate(parts.lng, 180);
  // 0,0 is what a missing lookup looks like, not a visitor in the Gulf of Guinea.
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return {
    lat,
    lng,
    city: label(parts.city),
    region: label(parts.region),
    country: label(parts.country)?.toUpperCase() ?? null,
  };
}

/** Read Cloudflare's `request.cf` object, when the runtime attached one. */
export function locationFromCf(cf: unknown): VisitorLocation | null {
  if (!cf || typeof cf !== "object") return null;
  const data = cf as Record<string, unknown>;
  return build({
    lat: data.latitude,
    lng: data.longitude,
    city: data.city,
    region: data.region,
    country: data.country,
  });
}

/**
 * Read the proxy's headers, falling back to Cloudflare's own visitor-location
 * headers (the "Add visitor location headers" managed transform).
 */
export function locationFromHeaders(headers: Headers): VisitorLocation | null {
  const own = build({
    lat: headers.get(VISITOR_HEADERS.lat),
    lng: headers.get(VISITOR_HEADERS.lng),
    city: decode(headers.get(VISITOR_HEADERS.city)),
    region: decode(headers.get(VISITOR_HEADERS.region)),
    country: headers.get(VISITOR_HEADERS.country),
  });
  if (own) return own;
  return build({
    lat: headers.get("cf-iplatitude"),
    lng: headers.get("cf-iplongitude"),
    city: decode(headers.get("cf-ipcity")),
    region: decode(headers.get("cf-region")),
    country: headers.get("cf-ipcountry"),
  });
}

/** Best effort for a raw Request, as route handlers receive it. */
export function locationFromRequest(request: Request): VisitorLocation | null {
  return (
    locationFromCf(Reflect.get(request, "cf")) ?? locationFromHeaders(request.headers)
  );
}

/**
 * Rewrite a copy of the request headers so they carry the visitor's location
 * and nothing a client made up.
 */
export function withVisitorHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const name of Object.values(VISITOR_HEADERS)) headers.delete(name);
  const location = locationFromCf(Reflect.get(request, "cf"));
  if (!location) return headers;
  headers.set(VISITOR_HEADERS.lat, String(location.lat));
  headers.set(VISITOR_HEADERS.lng, String(location.lng));
  // Header values must be ASCII; city names often are not.
  if (location.city) headers.set(VISITOR_HEADERS.city, encodeURIComponent(location.city));
  if (location.region)
    headers.set(VISITOR_HEADERS.region, encodeURIComponent(location.region));
  if (location.country) headers.set(VISITOR_HEADERS.country, location.country);
  return headers;
}

/** The visitor's location inside a server component. */
export async function getVisitorLocation(): Promise<VisitorLocation | null> {
  try {
    const { headers } = await import("next/headers");
    return locationFromHeaders(await headers());
  } catch {
    return null;
  }
}

/** Great-circle distance in km. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "350 m", "2.4 km", "38 km", "1,240 km". */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return Math.max(50, Math.round((km * 1000) / 50) * 50) + " m";
  if (km < 10) return km.toFixed(1) + " km";
  return Math.round(km).toLocaleString("en-US") + " km";
}
