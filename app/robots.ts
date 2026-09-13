import type { MetadataRoute } from "next";
import { canonical, SITE_URL } from "../src/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // JSON endpoints carry no crawlable content; the pages already do.
        disallow: ["/api/"],
      },
    ],
    sitemap: canonical("/sitemap.xml"),
    host: new URL(SITE_URL).host,
  };
}
