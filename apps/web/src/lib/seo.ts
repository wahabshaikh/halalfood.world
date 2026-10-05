/**
 * Pure helpers shared by page metadata, JSON-LD and the sitemap routes.
 * Nothing here touches the database, so it stays unit-testable.
 */
import { factAnswerLabel, FACTS, FACT_QUESTION, type Definite, type Fact, type PlaceStatus } from "@halalfood/core/halal";
import { displayCuisines } from "@halalfood/core/listing-visibility";

export const SITE_URL = "https://halalfood.world";
export const SITE_NAME = "halalfood.world";
export const OG_IMAGE = "/og.png";
export const ADD_OG_IMAGE = "/add-og.png";
export const TWITTER_SITE = "@iwahabshaikh";


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

/** Short status line for share sheets and Open Graph text. */
export function statusSharePhrase(status: PlaceStatus): string {
  if (status.kind === "verified") return "Verified: every halal fact is confirmed";
  if (status.kind === "checking") return `${status.progress} of 3 community checks so far`;
  return "Not checked yet";
}

export function cityDescription(slug: string, count: number) {
  const name = cityName(slug);
  const listed =
    count > 0 ? `${formatCount(count)} ${plural(count, "place")} in ${name}.` : `Places in ${name}.`;
  return fitSentences([
    listed,
    "See which are Muslim-owned, halal certified, and pork- and alcohol-free, checked by people who ate there.",
  ]);
}

type PlaceLike = AddressParts & {
  name: string;
  city_slug: string;
  serves_cuisine?: string[] | null;
};

export function placeTitle(place: PlaceLike) {
  const where = place.address_locality?.trim() || cityName(place.city_slug);
  return where ? `${place.name} in ${where}` : place.name;
}

export function placeShareText(name: string, where: string, status: PlaceStatus) {
  const place = where ? `${name} in ${where}` : name;
  return `${place}. ${statusSharePhrase(status)}.`;
}

/** Keep whole sentences. A trailing sentence is dropped before any sentence is cut mid-word. */
function fitSentences(parts: string[], max = 160) {
  const sentences = parts.map((part) => part.trim()).filter(Boolean);
  while (sentences.length > 1 && sentences.join(" ").length > max) sentences.pop();
  const text = sentences.join(" ");
  return text.length <= max ? text : truncate(text, max);
}

/** "Muslim-owned: Yes. Pork: Not served." for the facts that are known. */
export function factsSentence(facts: Record<Fact, Definite | null>): string {
  return FACTS.filter((fact) => facts[fact] !== null)
    .map((fact) => `${FACT_QUESTION[fact]}: ${factAnswerLabel(fact, facts[fact])}.`)
    .join(" ");
}

export function placeDescription(
  place: PlaceLike,
  status: PlaceStatus,
  facts: Record<Fact, Definite | null>,
) {
  const where = place.address_locality?.trim() || cityName(place.city_slug);
  const cuisine = displayCuisines(place.serves_cuisine)[0];
  return fitSentences([
    `${place.name}${cuisine ? `, ${cuisine},` : ""} in ${where}.`,
    `${statusSharePhrase(status)}.`,
    factsSentence(facts),
  ]);
}

type JsonLdPlace = PlaceLike & {
  id: string;
  telephone?: string | null;
  website?: string | null;
  postal_code?: string | null;
  lat?: number | null;
  lng?: number | null;
};

/** Schema.org `Restaurant`, with the community status as properties, never as a rating. */
export function placeJsonLd(
  place: JsonLdPlace,
  options: { mapsUrl?: string | null; status: PlaceStatus; facts: Record<Fact, Definite | null> },
) {
  const url = canonical(`/place/${place.id}`);
  const hasGeo =
    typeof place.lat === "number" &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng);
  const cuisines = displayCuisines(place.serves_cuisine);
  const properties = [
    { "@type": "PropertyValue", name: "communityStatus", value: statusSharePhrase(options.status) },
    ...FACTS.filter((fact) => options.facts[fact] !== null).map((fact) => ({
      "@type": "PropertyValue",
      name: FACT_QUESTION[fact],
      value: factAnswerLabel(fact, options.facts[fact]),
    })),
  ];
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
    geo: hasGeo ? { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lng } : undefined,
    additionalProperty: properties,
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
