import type { MetadataRoute } from "next";
import { canonical } from "../../../src/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: canonical("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: canonical("/cities"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
