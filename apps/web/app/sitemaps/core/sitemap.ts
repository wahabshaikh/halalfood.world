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
    {
      url: canonical("/guides"),
      changeFrequency: "weekly",
      priority: 0.85,
    },
    {
      url: canonical("/events"),
      changeFrequency: "daily",
      priority: 0.6,
    },
    {
      url: canonical("/leaderboard"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
  ];
}
