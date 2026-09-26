export function limitParam(value: string | null, max = 600) {
  if (value === null) return Math.min(400, max);
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw new Error("limit must be a positive integer");
  return Math.min(Number(value), max);
}
export function bboxParam(value: string | null) {
  if (
    !value ||
    value.split(",").length !== 4 ||
    value.split(",").some((v) => !v.trim())
  )
    throw new Error("bbox must be west,south,east,north");
  const [west, south, east, north] = value.split(",").map(Number);
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    Math.abs(west) > 180 ||
    Math.abs(east) > 180 ||
    south < -90 ||
    north > 90 ||
    south >= north
  ) {
    throw new Error("Invalid bbox bounds");
  }
  return { west, south, east, north };
}

/**
 * Page segments come straight from the URL, so every reader below returns a
 * narrow, already-validated value or `null`. Pages render a 404 on `null`
 * instead of handing unchecked text to the query layer.
 */
const CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function citySlugParam(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  if (slug.length < 1 || slug.length > 120 || !CITY_SLUG.test(slug)) return null;
  return slug;
}

export function placeIdParam(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/** Zero-based page index, clamped so deep pagination cannot walk the table. */
export function pageParam(value: string | string[] | null | undefined, max = 200) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), max);
}
