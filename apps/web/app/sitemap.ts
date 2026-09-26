import { countPlaces } from "../src/lib/places";
import {
  placeChunkIds,
  sitemapIndexXml,
  type SitemapIndexEntry,
} from "../src/lib/sitemap";

/**
 * Returns a `<sitemapindex>` rather than the `<urlset>` the framework helper
 * builds, so the default export hands back a Response directly.
 */
export default async function sitemap() {
  const entries: SitemapIndexEntry[] = [
    { path: "/sitemaps/core/sitemap.xml" },
    { path: "/sitemaps/cities/sitemap.xml" },
  ];
  try {
    for (const id of placeChunkIds(await countPlaces()))
      entries.push({ path: `/sitemaps/places/sitemap/${id}.xml` });
  } catch {
    // Still advertise the core and city sitemaps if the count query fails.
  }
  return new Response(sitemapIndexXml(entries), {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
