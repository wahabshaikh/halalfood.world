import type { MetadataRoute } from "next";
import { canonical } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: canonical("/"), changeFrequency: "daily", priority: 1 },
    { url: canonical("/cities"), changeFrequency: "weekly", priority: 0.8 },
    { url: canonical("/events"), changeFrequency: "daily", priority: 0.6 },
    { url: canonical("/community"), changeFrequency: "weekly", priority: 0.5 },
  ];
}
