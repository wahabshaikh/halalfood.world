import type { MetadataRoute } from "next";
import { listCities } from "@/lib/places";
import { canonical } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const cities = await listCities({ limit: 2000 });
  return cities.flatMap((city) => [
    {
      url: canonical(`/city/${city.city_slug}`),
      changeFrequency: "weekly" as const,
      // Cities with more listings are worth recrawling sooner.
      priority: city.place_count >= 100 ? 0.8 : 0.6,
    },
  ]);
}
