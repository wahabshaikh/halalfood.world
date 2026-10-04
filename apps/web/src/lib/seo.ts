/**
 * Pure helpers shared by page metadata, JSON-LD and the sitemap routes.
 * Nothing here touches the database, so it stays unit-testable.
 */
import type { HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";
import { displayCuisines } from "@halalfood/core/listing-visibility";

export const SITE_URL = "https://halalfood.world";
export const SITE_NAME = "halalfood.world";
export const OG_IMAGE = "/og.png";
export const ADD_OG_IMAGE = "/add-og.png";
export const TWITTER_SITE = "@iwahabshaikh";

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
    ? `${formatCount(count)} ${plural(count, "place")} listed in ${name}`
    : `Places listed in ${name}`;
}

export type CityEvidenceCounts = {
  indexed: number;
  enriched: number;
  intelligent: number;
  trusted: number;
};

const CERTIFICATION = "A listing is not a halal certification.";

/**
 * Short evidence line for share sheets and Open Graph text.
 * `null` means the evidence read failed, so the line does not invent Unverified.
 */
export function evidenceSharePhrase(status: HalalTaxonomyStatus | null): string {
  switch (status) {
    case "verified":
      return "Verified halal, checked by the community";
    case "community-verified":
      return "Community verified, checked by the community";
    case "halal-options":
      return "Halal options, checked by the community";
    case "self-declared":
      return "Self-declared, not independently checked by the community";
    case "not-halal":
      return "Not halal, checked by the community";
    case "unverified":
      return "Unverified, not yet checked by the community";
    default:
      return "Evidence status could not be loaded";
  }
}

/** City-wide evidence line from the coverage counts, not a single place status. */
export function cityEvidencePhrase(coverage: CityEvidenceCounts | null): string {
  if (!coverage) return "Evidence status could not be loaded";
  const checked = coverage.enriched + coverage.intelligent + coverage.trusted;
  if (checked <= 0) return "Unverified, not yet checked by the community";
  if (coverage.indexed <= 0) return "Checked by the community";
  return `${formatCount(checked)} checked by the community; the rest are unverified`;
}

export function cityDescription(
  slug: string,
  count: number,
  coverage?: CityEvidenceCounts | null,
) {
  const name = cityName(slug);
  const listed =
    count > 0
      ? `${formatCount(count)} ${plural(count, "place")} listed in ${name}.`
      : `Places listed in ${name}.`;
  const approximate = "Addresses are approximate — confirm before visiting.";
  return fitSentences(
    coverage === undefined
      ? [listed, CERTIFICATION, approximate]
      : [listed, `${cityEvidencePhrase(coverage)}.`, CERTIFICATION, approximate],
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
  return where ? `${place.name} in ${where}` : place.name;
}

/** Share sheet text. The evidence phrase follows the place's real status. */
export function placeShareText(
  name: string,
  where: string,
  status: HalalTaxonomyStatus | null,
) {
  const place = where ? `${name} in ${where}` : name;
  return `${place}. ${evidenceSharePhrase(status)}. ${CERTIFICATION}`;
}

export type PlaceDescriptionOptions = {
  includeCommunity?: boolean;
  /** Real taxonomy status. `null` means the evidence read failed. */
  evidenceStatus?: HalalTaxonomyStatus | null;
};

/** Keep whole sentences. A trailing sentence is dropped before any sentence is cut mid-word. */
function fitSentences(parts: string[], max = 160) {
  const sentences = parts.map((part) => part.trim()).filter(Boolean);
  while (sentences.length > 1 && sentences.join(" ").length > max) sentences.pop();
  const text = sentences.join(" ");
  return text.length <= max ? text : truncate(text, max);
}

export function placeDescription(
  place: PlaceLike,
  options: PlaceDescriptionOptions = {},
) {
  const where = place.address_locality?.trim() || cityName(place.city_slug);
  const listed = `${place.name} is listed in ${where}.`;
  const certification = CERTIFICATION;
  const approximate = "Map location is approximate.";
  const evidence =
    options.evidenceStatus !== undefined
      ? `${evidenceSharePhrase(options.evidenceStatus)}.`
      : "";
  const rating =
    place.rating_value && Number.isFinite(Number(place.rating_value))
      ? `Google rating ${place.rating_value}${
          options.includeCommunity || !place.review_count
            ? ""
            : ` from ${formatCount(place.review_count)} ${plural(place.review_count, "review")}`
        }.`
      : "";
  const address = formatAddress(place);
  return fitSentences(
    options.includeCommunity
      ? [
          listed,
          evidence,
          certification,
          approximate,
          rating,
          "Community evidence is separate from the Google rating.",
        ]
      : [
          listed,
          evidence,
          certification,
          approximate,
          rating,
          address ? `Address: ${address}.` : "",
        ],
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
  const cuisines = displayCuisines(place.serves_cuisine);
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": url,
    url,
    name: place.name,
    servesCuisine: cuisines.length ? cuisines : undefined,
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
