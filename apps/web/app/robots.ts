import type { MetadataRoute } from "next";
import { canonical, SITE_URL } from "../src/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // JSON endpoints carry no crawlable content; the pages already do.
        // Search result pages are thin duplicates of city and place pages,
        // and each distinct query is a full-table text scan.
        disallow: ["/api/", "/search"],
      },
    ],
    sitemap: canonical("/sitemap.xml"),
    host: new URL(SITE_URL).host,
  };
}
