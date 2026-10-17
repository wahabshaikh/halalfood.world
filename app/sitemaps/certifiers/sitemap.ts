import type { MetadataRoute } from "next";
import { countrySlug } from "@/lib/certifiers/countries";
import { IMPORTING_COUNTRIES } from "@/lib/certifiers/importing";
import { certifierSitemapEntries } from "@/lib/certifiers/repository";
import { SEED_CHECKED_AT } from "@/lib/certifiers/seed-sql";
import { canonical } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * The certifier directory. `lastmod` is the last real change to the data a page shows (a body added,
 * renewed, renamed…), never the last check: a daily check that finds nothing must not look like news.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const { certifiers, authorities, fromCountries } = await certifierSitemapEntries();
    const latest = Math.max(SEED_CHECKED_AT, ...authorities.map((each) => each.lastModified));
    const at = (ms: number) => new Date(ms);
    return [
      { url: canonical("/certifiers"), lastModified: at(latest), changeFrequency: "daily", priority: 0.7 },
      ...IMPORTING_COUNTRIES.map((country) => ({
        url: canonical(`/certifiers/country/${country.slug}`),
        lastModified: at(authorities.find((each) => each.authorityId === country.authorityId)?.lastModified ?? SEED_CHECKED_AT),
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...IMPORTING_COUNTRIES.flatMap((country) => (country.guide ? [{ url: canonical(country.guide.path), lastModified: at(SEED_CHECKED_AT), priority: 0.5 }] : [])),
      { url: canonical("/certifiers/changes"), lastModified: at(latest), changeFrequency: "daily", priority: 0.4 },
      { url: canonical("/certifiers/methodology"), lastModified: at(SEED_CHECKED_AT), priority: 0.3 },
      { url: canonical("/certifiers/alerts"), priority: 0.3 },
      ...fromCountries.flatMap((each) => {
        const slug = countrySlug(each.countryCode);
        return slug ? [{ url: canonical(`/certifiers/from/${slug}`), lastModified: at(each.lastModified), priority: 0.4 }] : [];
      }),
      ...certifiers.map((each) => ({ url: canonical(each.path), lastModified: at(each.lastModified), changeFrequency: "weekly" as const, priority: 0.5 })),
    ];
  } catch {
    return [];
  }
}
