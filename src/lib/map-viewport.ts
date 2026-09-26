/**
 * The first map camera and the rule for when a viewport query is allowed to run.
 *
 * Zoom 14 around the default centre covers only a few blocks, and the live
 * catalogue has no restaurants in that patch, so the map opened empty. Zoom 12
 * is wide enough to show the surrounding city on the first load.
 */
export const DEFAULT_MAP_VIEW = {
  center: [72.8777, 19.055] as [number, number],
  zoom: 12,
};

export type MapDeepLink = "place" | "city";

export function deepLinkKind(params: URLSearchParams): MapDeepLink | null {
  if (params.get("place")) return "place";
  if (params.get("city")) return "city";
  return null;
}

/**
 * A `?city=` or `?place=` link moves the camera after the map is ready.
 * Querying before that move returns the default neighbourhood and then leaves
 * those stale rows on screen, with "Search this area" as the only way to see
 * the place the link was for.
 */
export function shouldLoadViewport(
  kind: MapDeepLink | null,
  deepLinkSettled: boolean,
): boolean {
  return kind === null || deepLinkSettled;
}
