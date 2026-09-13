import type { MetadataRoute } from "next";
import { countPlaces, listPlaceRefs } from "../../../src/lib/places";
import { canonical } from "../../../src/lib/seo";
import { PLACE_CHUNK, placeChunkIds, toLastModified } from "../../../src/lib/sitemap";

export async function generateSitemaps() {
  return placeChunkIds(await countPlaces()).map((id) => ({ id }));
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  const chunk = Number(await id) || 0;
  const places = await listPlaceRefs({
    limit: PLACE_CHUNK,
    offset: chunk * PLACE_CHUNK,
  });
  return places.map((place) => ({
    url: canonical(`/place/${place.id}`),
    lastModified: toLastModified(place.scraped_at),
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));
}
