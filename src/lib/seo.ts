/**
 * Pure helpers shared by page metadata, JSON-LD and the sitemap routes.
 * Nothing here touches the database, so it stays unit-testable.
 */
export const SITE_URL = "https://halalfood.world";
export const SITE_NAME = "Halalfood";
export const OG_IMAGE = "/og.png";

/** Every pin is a city centroid plus jitter, so say so wherever we show one. */
export const APPROXIMATE_NOTE =
  "Pin locations are approximate — they are placed near the city centre, not surveyed at the door. Confirm the address before you travel.";

export function canonical(path = "/") {
  return new URL(path, SITE_URL).href;
}

/** "new-york-city" -> "New York City". Small words stay lowercase mid-name. */
const MINOR_WORDS = new Set(["and", "de", "of", "on", "the", "upon"]);
export function cityName(slug: string) {
  const words = slug.split("-").filter(Boolean);
  if (!words.length) return "";
  return words
    .map((word, index) =>
      index > 0 && MINOR_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/** Trim to a whole word so descriptions never end mid-syllable. */
export function truncate(text: string, max = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? singular : (pluralForm ?? singular + "s");
}

export function formatCount(count: number) {
  return count.toLocaleString("en-US");
}

type AddressParts = {
  street_address?: string | null;
  address_locality?: string | null;
  address_region?: string | null;
  address_country?: string | null;
};

export function formatAddress(parts: AddressParts) {
  return [
    parts.street_address,
    parts.address_locality,
    parts.address_region,
    parts.address_country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

export function cityTitle(slug: string, count: number) {
  const name = cityName(slug);
  return count > 0
    ? `${formatCount(count)} halal ${plural(count, "restaurant")} in ${name}`
    : `Halal restaurants in ${name}`;
}

export function cityDescription(slug: string, count: number) {
  const name = cityName(slug);
  return truncate(
    count > 0
      ? `Browse ${formatCount(count)} halal ${plural(count, "restaurant")} in ${name} on the Halalfood map, with addresses, phone numbers and ratings. Locations are approximate — confirm before visiting.`
      : `Halal restaurants in ${name} on the Halalfood map. Locations are approximate — confirm before visiting.`,
  );
}

type PlaceLike = AddressParts & {
  name: string;
  city_slug: string;
  rating_value?: string | null;
  review_count?: number | null;
  serves_cuisine?: string[] | null;
};

export function placeTitle(place: PlaceLike) {
  const where = place.address_locality?.trim() || cityName(place.city_slug);
  return where ? `${place.name} — halal food in ${where}` : place.name;
}

export type PlaceDescriptionOptions = {
  includeCommunity?: boolean;
};

export function placeDescription(
  place: PlaceLike,
  options: PlaceDescriptionOptions = {},
) {
  const where = place.address_locality?.trim() || cityName(place.city_slug);
  const cuisine = place.serves_cuisine?.filter(Boolean).slice(0, 3).join(", ");
  const rating =
    place.rating_value && Number.isFinite(Number(place.rating_value))
      ? `Rated ${place.rating_value}${
          place.review_count
            ? ` from ${formatCount(place.review_count)} ${plural(place.review_count, "review")}`
            : ""
        }.`
      : "";
  const address = formatAddress(place);
  const main = `${place.name} is a halal ${cuisine ? cuisine + " " : ""}restaurant in ${where}.`;
  if (options.includeCommunity) {
    const shortRating =
      place.rating_value && Number.isFinite(Number(place.rating_value))
        ? `Rated ${place.rating_value}.`
        : "";
    return truncate(
      [
        main,
        shortRating,
        "Community halal reviews, photos, reactions and evidence.",
        "Map location is approximate.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return truncate(
    [
      main,
      rating,
      address ? `Address: ${address}.` : "",
      "Location on the map is approximate.",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

type JsonLdPlace = PlaceLike & {
  id: string;
  telephone?: string | null;
  website?: string | null;
  postal_code?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type PlaceJsonLdOptions = {
  mapsUrl?: string | null;
  communityNote?: string | null;
  communityReviewCount?: number | null;
  communityVerificationCount?: number | null;
};

/**
 * Schema.org `Restaurant`. `geo` is emitted with
 * `additionalProperty: locationPrecision = approximate` so consumers are not
 * misled into treating a jittered centroid as a surveyed coordinate.
 */
export function placeJsonLd(
  place: JsonLdPlace,
  options: PlaceJsonLdOptions = {},
) {
  const url = canonical(`/place/${place.id}`);
  const rating =
    place.rating_value && Number.isFinite(Number(place.rating_value))
      ? {
          "@type": "AggregateRating",
          ratingValue: Number(place.rating_value),
          ...(place.review_count ? { reviewCount: place.review_count } : {}),
          bestRating: 5,
          worstRating: 1,
        }
      : undefined;
  const hasGeo =
    typeof place.lat === "number" &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng);
  const communityProperties: {
    "@type": "PropertyValue";
    name: string;
    value: string | number;
  }[] = [];
  if (
    typeof options.communityReviewCount === "number" &&
    Number.isInteger(options.communityReviewCount) &&
    options.communityReviewCount >= 0
  )
    communityProperties.push({
      "@type": "PropertyValue",
      name: "communityReviewCount",
      value: options.communityReviewCount,
    });
  if (
    typeof options.communityVerificationCount === "number" &&
    Number.isInteger(options.communityVerificationCount) &&
    options.communityVerificationCount >= 0
  )
    communityProperties.push({
      "@type": "PropertyValue",
      name: "communityVerificationCount",
      value: options.communityVerificationCount,
    });
  const communityNote = options.communityNote?.trim();
  if (communityNote)
    communityProperties.push({
      "@type": "PropertyValue",
      name: "communityEvidenceNote",
      value: communityNote,
    });
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": url,
    url,
    name: place.name,
    servesCuisine: place.serves_cuisine?.length
      ? place.serves_cuisine
      : undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: place.street_address || undefined,
      addressLocality: place.address_locality || undefined,
      addressRegion: place.address_region || undefined,
      postalCode: place.postal_code || undefined,
      addressCountry: place.address_country || undefined,
    },
    telephone: place.telephone || undefined,
    sameAs: place.website || undefined,
    hasMap: options.mapsUrl || undefined,
    aggregateRating: rating,
    geo: hasGeo
      ? {
          "@type": "GeoCoordinates",
          latitude: place.lat,
          longitude: place.lng,
          additionalProperty: {
            "@type": "PropertyValue",
            name: "locationPrecision",
            value: "approximate",
          },
        }
      : undefined,
    isAccessibleForFree: undefined,
    disambiguatingDescription: APPROXIMATE_NOTE,
    additionalProperty: communityProperties.length ? communityProperties : undefined,
  };
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: canonical(crumb.path),
    })),
  };
}

/** `<script type="application/ld+json">` payload with `<` escaped. */
export function jsonLdScript(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
