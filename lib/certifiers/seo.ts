/**
 * Titles and JSON-LD for the certifier pages. Pure, like lib/seo.ts. Titles in this section end in
 * " | halalfood.world" and are set as absolute titles, so they read as search results expect.
 */
import { canonical, SITE_NAME, SITE_URL } from "@/lib/seo";
import { formatDay, formatIsoDate } from "./display";
import type { ImportingCountry } from "./importing";
import type { RecognitionRow } from "./repository";

export const sectionTitle = (text: string) => `${text} | ${SITE_NAME}`;

export function countryPageTitle(country: ImportingCountry, checkedAt: number | null): string {
  const day = formatDay(checkedAt);
  return sectionTitle(`${country.authorityShort} recognised foreign halal certification bodies${day ? ` (updated ${day})` : ""}`);
}

export function hubTitle(checkedAt: number | null): string {
  const day = formatDay(checkedAt);
  return sectionTitle(`Halal certifiers accepted by importing countries${day ? ` (updated ${day})` : ""}`);
}

export function certifierTitle(name: string, recognitions: readonly RecognitionRow[], authorityShort: (id: string) => string): string {
  const listed = recognitions.filter((rec) => rec.status !== "removed");
  if (!listed.length) return sectionTitle(`${name}: halal certifier recognition`);
  const first = listed[0];
  const date = formatIsoDate(first.validUntil);
  return sectionTitle(`${name}: recognised by ${listed.map((rec) => authorityShort(rec.authorityId)).join(", ")}${listed.length === 1 && date ? ` until ${date}` : ""}`);
}

const PUBLISHER = { "@type": "Organization", name: SITE_NAME, url: SITE_URL };

/** Schema.org `Dataset` for one authority's list, pointing at the official source and our CSV. */
export function countryDatasetJsonLd(country: ImportingCountry, options: { officialUrl: string; count: number; modifiedAt: number; checkedAt: number | null }) {
  const page = canonical(`/certifiers/country/${country.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": page,
    url: page,
    name: `${country.authorityShort} recognised foreign halal certification bodies`,
    description: `The ${options.count} foreign halal certification bodies on the list published by ${country.authorityLong}, with scopes, validity dates and registration numbers as the official list gives them. Copied from the official list; always confirm with ${country.authorityShort}.`,
    isBasedOn: options.officialUrl,
    spatialCoverage: { "@type": "Country", name: country.name },
    creator: PUBLISHER,
    publisher: PUBLISHER,
    isAccessibleForFree: true,
    dateModified: new Date(options.modifiedAt).toISOString(),
    distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: canonical(`/certifiers/country/${country.slug}.csv`) }],
    variableMeasured: ["Certifier name", "Based in", "Scopes", "Valid until", "Registration number"],
  };
}

/** Schema.org `Organization` for a certifier, with only what the official list says about it. */
export function certifierJsonLd(certifier: { slug: string; name: string; countryCode: string | null; city: string | null; address: string | null; website: string | null }) {
  const url = canonical(`/certifiers/${certifier.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": url,
    url,
    name: certifier.name,
    address:
      certifier.address || certifier.city || certifier.countryCode
        ? {
            "@type": "PostalAddress",
            streetAddress: certifier.address || undefined,
            addressLocality: certifier.city || undefined,
            addressCountry: certifier.countryCode || undefined,
          }
        : undefined,
    sameAs: certifier.website || undefined,
  };
}
