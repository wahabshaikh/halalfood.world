import type { City } from "./places";
import { cityName, formatCount, plural, truncate } from "./seo";

export function guidePath(citySlug: string) {
  return "/guides/" + encodeURIComponent(citySlug);
}

export function guideTitle(citySlug: string) {
  return "A halal food guide to " + cityName(citySlug);
}

export function guideDescription(city: Pick<City, "city_slug" | "place_count">) {
  const name = cityName(city.city_slug);
  return truncate(
    city.place_count
      ? `A practical starting point for halal food in ${name}: ${formatCount(
          city.place_count,
        )} listed ${plural(city.place_count, "place")}, with source details and community evidence to check before you go.`
      : `A practical starting point for halal food in ${name}, with source details and community evidence to check before you go.`,
  );
}

export const GUIDE_SELECTION_NOTE =
  "Guide starting points are ordered by the public listing rating and review volume already on the map. They are not paid placements or halal certification.";

export function guideKicker(city: Pick<City, "city_slug" | "address_country">) {
  return [cityName(city.city_slug), city.address_country].filter(Boolean).join(" · ");
}
