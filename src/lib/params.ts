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
