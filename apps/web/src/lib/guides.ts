import type { City } from "./places";
import { cityName, formatCount, plural, truncate } from "./seo";

export function guidePath(citySlug: string) {
  return "/guides/" + encodeURIComponent(citySlug);
}

export function guideTitle(citySlug: string) {
  return "A starting guide to places listed in " + cityName(citySlug);
}

export function guideDescription(city: Pick<City, "city_slug" | "place_count">) {
  const name = cityName(city.city_slug);
  return truncate(
    city.place_count
      ? `A starting point for places listed in ${name}: ${formatCount(
          city.place_count,
        )} listed ${plural(city.place_count, "place")}. A listing is not a halal certification.`
      : `A starting point for places listed in ${name}. A listing is not a halal certification.`,
  );
}

export const GUIDE_SELECTION_NOTE =
  "Editorial order follows the public Google rating and review volume already on the listing. That is not a halal ranking, a paid placement, or a certification.";

/** Shown on every guide pick so a Google sort is not read as evidence. */
export const GUIDE_PICK_NOTE =
  "Each pick below shows its own evidence status and date. If that line says unverified, the guide has no dated evidence for it.";

export function guideKicker(city: Pick<City, "city_slug" | "address_country">) {
  return [cityName(city.city_slug), city.address_country].filter(Boolean).join(" · ");
}
