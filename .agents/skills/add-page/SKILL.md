---
name: add-page
description: Add or change a page in apps/web/app with server rendering, metadata, graceful degradation, shared chrome and shadcn components. Use for any new screen or route.
---

# Add a page

Pages are App Router server components at `apps/web/app/<path>/page.tsx`.
Public, crawlable pages follow `app/city/[citySlug]/page.tsx`; signed-in
screens follow `app/feed/page.tsx` (server shell plus a client `*-view.tsx`
that calls `/api`).

## Steps

1. **Check the design first.** Social screens are specified in
   `docs/design/social-community.html`; trust and status rules in
   `docs/product/`. Keep the existing branding and theme tokens.
2. **Shell.** Wrap content in `Page`, `SiteHeader`, `PageMain` and
   `SiteFooter` from `src/components/site-chrome.tsx`. Use `PageIntro`,
   `Breadcrumbs`, `EmptyPanel` and `Unavailable` from the same file, and
   `SectionHeading` / `Note` from `section.tsx`, before inventing new blocks.
3. **Data.** Load in the server component through a `cache()`-wrapped loader
   that validates params (`@halalfood/core/params`) and calls
   `loadOrDegrade` from `src/lib/load.ts`:
   - `missing` means `notFound()`;
   - `error` renders `<Unavailable retryPath=... />` and metadata with
     `robots: { index: false, follow: true }`.
   Use `read-cache.ts` only for public data that is identical for every visitor.
4. **Metadata.** Export `metadata` or `generateMetadata` with `title`,
   `description`, `alternates.canonical`, and Open Graph/Twitter for public
   pages. Put reusable title/description/JSON-LD builders in `src/lib/seo.ts`
   and test them in `tests/seo.test.ts`. Personal pages (feed, saved,
   settings) are `noindex`.
5. **Client parts.** Put interactivity in a sibling `*-view.tsx` /
   `*-form.tsx` with `"use client"`. Signed-in data comes from `/api` routes
   (see skill `add-api-route`), not from server components reading the session,
   unless an existing page already does so for that area.
6. **UI.** Compose `@halalfood/ui/components/*` with Tailwind utilities on
   theme tokens; icons from `@hugeicons/core-free-icons` via
   `HugeiconsIcon`. Missing component: `cd packages/ui && npx shadcn@latest add <name>`.
7. **Halal status.** Show status only through the existing view helpers in
   `@halalfood/core/halal-status-view` and `halal-glance-view` and components
   such as `decision-summary.tsx`. Never derive a status from social signals.
8. **Discoverability.** Public pages that should be indexed go in the
   relevant sitemap under `app/sitemaps/`. Add navigation only where the design
   puts it.

## Verify

`npm run check`, then `npm run build` (catches server/client boundary
mistakes that typecheck misses), then open the page in `npm run dev` or on the
PR preview, signed out and signed in. See skill `verify-change`.
