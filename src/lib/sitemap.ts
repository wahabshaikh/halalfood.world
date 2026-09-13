import { canonical } from "./seo";

/**
 * Sitemap layout
 * --------------
 * `/sitemap.xml` is a sitemap **index**, not a urlset. ~12k places plus a few
 * hundred cities would fit inside one file, but a single document would mean
 * one large query per crawl and a full re-fetch whenever any row changes.
 * The index instead points at:
 *
 *   /sitemaps/core/sitemap.xml       home + city directory
 *   /sitemaps/cities/sitemap.xml     one entry per distinct `city_slug`
 *   /sitemaps/places/sitemap/N.xml   places, {@link PLACE_CHUNK} per file
 *
 * Chunks are cut from an id-ordered scan so boundaries stay stable between
 * requests. {@link MAX_PLACE_CHUNKS} caps the index if the table ever grows
 * far beyond today's size.
 */
export const PLACE_CHUNK = 5000;
export const MAX_PLACE_CHUNKS = 50;

export function placeChunkCount(totalPlaces: number) {
  return Math.min(
    Math.max(Math.ceil(totalPlaces / PLACE_CHUNK), 0),
    MAX_PLACE_CHUNKS,
  );
}

export function placeChunkIds(totalPlaces: number) {
  return Array.from({ length: placeChunkCount(totalPlaces) }, (_, id) => id);
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export type SitemapIndexEntry = { path: string; lastModified?: Date };

export function sitemapIndexXml(entries: SitemapIndexEntry[]) {
  const body = entries
    .map(
      ({ path, lastModified }) =>
        "<sitemap>\n" +
        `<loc>${escapeXml(canonical(path))}</loc>\n` +
        (lastModified
          ? `<lastmod>${lastModified.toISOString()}</lastmod>\n`
          : "") +
        "</sitemap>\n",
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body +
    "</sitemapindex>\n"
  );
}

/** `scraped_at` arrives as a Date or an ISO string; unparseable values drop. */
export function toLastModified(value: string | Date | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
