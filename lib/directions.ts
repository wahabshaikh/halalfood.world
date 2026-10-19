/** Build directions from coordinates, an address, or the original map listing. */
export function directionsUrl(app: "google" | "apple", p: { name: string; lat: number | null; lng: number | null; address?: string | null; mapsUrl?: string | null }): string | null {
  const coordinates = p.lat !== null && p.lng !== null ? `${p.lat},${p.lng}` : null;
  if (!coordinates && !p.address) return p.mapsUrl || null;
  if (app === "apple") {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(coordinates ?? p.address!)}&q=${encodeURIComponent(p.name)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates ?? `${p.name}, ${p.address}`)}`;
}

/** Prefer an explicit choice, then the device's usual maps app. */
export function preferredMapsApp(stored: string | null, userAgent: string): "google" | "apple" {
  if (stored === "google" || stored === "apple") return stored;
  return /iPhone|iPad|iPod/i.test(userAgent) ? "apple" : "google";
}
