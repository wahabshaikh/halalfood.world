/**
 * What Explore, the map, search and saved lists send to the browser: place
 * cards decorated with the viewer's saves and friend lines.
 */
import { bboxParam, citySlugParam } from "@halalfood/core/params";
import { parseFilters, type Filter } from "@halalfood/core/halal";
import { database } from "../db";
import { explorePlaces, type ExploreQuery } from "./places";
import type { PlaceCard } from "./place-view";
import { d1SavedPlaceRepository } from "./saved-places";
import { followeeIds, friendLines, type FriendLine } from "./social";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type ExploreItem = PlaceCard & { saved: boolean; friend: FriendLine | null };

export async function decoratePlaces(
  viewerId: string | null,
  places: PlaceCard[],
  client: Client = database(),
): Promise<ExploreItem[]> {
  if (!viewerId || !places.length) return places.map((place) => ({ ...place, saved: false, friend: null }));
  const ids = places.map((place) => place.id);
  const [saved, friends] = await Promise.all([
    d1SavedPlaceRepository(client).savedIds(viewerId, ids),
    friendLines(viewerId, ids, client),
  ]);
  return places.map((place) => ({ ...place, saved: saved.has(place.id), friend: friends.get(place.id) ?? null }));
}

export type ExploreParams = {
  citySlug: string | null;
  bbox: ExploreQuery["bbox"];
  near: { lat: number; lng: number } | null;
  filters: Filter[];
  friends: boolean;
  offset: number;
  limit: number;
};

/** Parse `?city=&bbox=&near=lat,lng&filters=&friends=1&offset=&limit=`. Throws on a malformed bbox. */
export function parseExploreParams(params: URLSearchParams, maxLimit = 200): ExploreParams {
  const near = (() => {
    const [lat, lng] = (params.get("near") ?? "").split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && params.get("near")
      ? { lat, lng }
      : null;
  })();
  const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), maxLimit);
  return {
    citySlug: citySlugParam(params.get("city")),
    bbox: params.get("bbox") ? bboxParam(params.get("bbox")) : null,
    near,
    filters: parseFilters(params.get("filters")),
    friends: params.get("friends") === "1",
    offset: Math.max(Number(params.get("offset")) || 0, 0),
    limit,
  };
}

export async function loadExplore(
  viewerId: string | null,
  params: ExploreParams,
  client: Client = database(),
): Promise<{ places: ExploreItem[]; total: number }> {
  const friendIds = params.friends ? (viewerId ? await followeeIds(viewerId, client) : []) : null;
  const result = await explorePlaces(
    {
      citySlug: params.bbox ? null : params.citySlug,
      bbox: params.bbox,
      near: params.near,
      filters: params.filters,
      friendIds,
      limit: params.limit,
      offset: params.offset,
    },
    client,
  );
  return { places: await decoratePlaces(viewerId, result.places, client), total: result.total };
}
