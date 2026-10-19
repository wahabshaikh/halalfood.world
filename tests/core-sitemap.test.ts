import { test } from "vitest";
import assert from "node:assert/strict";
import sitemap from "@/app/sitemaps/core/sitemap";
import { canonical } from "@/lib/seo";

test("the core sitemap lists the static pages, including How trust works", () => {
  const urls = sitemap().map((entry) => entry.url);
  for (const path of ["/", "/cities", "/community", "/how-trust-works", "/newsletter", "/sponsor"]) assert.ok(urls.includes(canonical(path)), path);
});
