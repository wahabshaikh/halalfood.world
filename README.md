# halalfood.world

A full-screen halal food map built with vinext, React, MapLibre GL, Drizzle and the Neon serverless HTTP driver, deployed as a Cloudflare Worker. The interface uses CARTO Positron with OpenStreetMap attribution.

The map is the product; server-rendered city and place pages sit underneath it so the listings are crawlable, linkable and shareable without JavaScript.

## Local setup

Use Node 22:

```sh
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH"
node --version
npm ci
```

Create a **gitignored** `.dev.vars` in the repo root containing `DATABASE_URL=<your Neon connection string>`. Do not put it in a client variable or commit it. The Cloudflare Vite plugin loads this file; the Worker reads the binding through `process.env.DATABASE_URL` with Node compatibility enabled.

```sh
npm run dev
npm run typecheck
npm test
# With the dev server running in another terminal:
npm run test:api
npx playwright install chromium
npm run test:browser
npm run build
npm start
```

Use the URL printed by the dev server. Development and production API requests run against the existing Neon `neondb`; there are no migrations or write operations.

## Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Client map + SSR `WebSite`/`FAQPage` JSON-LD | The map. Accepts the deep links below. |
| `/cities` | SSR | Directory of every city, largest first. |
| `/city/[citySlug]` | SSR | Listings for one city, 60 per page, with `ItemList` + `BreadcrumbList` JSON-LD. |
| `/place/[id]` | SSR | One place, with `Restaurant` + `BreadcrumbList` JSON-LD. |
| `/robots.txt`, `/sitemap.xml` | Metadata routes | See below. |
| `/api/places`, `/api/places/search` | JSON | Viewport and search queries. |
| `/api/places/[id]`, `/api/cities/[citySlug]` | JSON | Lookups behind the map deep links. |

Dynamic segments are validated before they reach SQL: `citySlugParam` accepts only lowercase kebab-case, `placeIdParam` only UUIDs, and `pageParam` clamps the page index. An unparseable segment is a 404 and never costs a query.

City and place pages distinguish a missing row (a real 404) from an unreachable database (a `noindex, follow` "temporarily unavailable" page). A transient outage must never be indexed as if it were the page's content.

### Deep links and sharing

- `/?place=<uuid>` opens the map on that pin and its popup.
- `/?city=<slug>` frames the city on the map.
- `/?lat=<lat>&lng=<lng>&z=<zoom>` sets the initial view; invalid values fall back to the default view.
- Selecting a pin rewrites the address bar to `/?place=<uuid>` with `replaceState`, so the browser's own share button works.
- Popups, city pages and place pages carry a Share control: Web Share where available, clipboard otherwise, and a selectable URL if both are blocked. Shared links point at the canonical `/place/<id>` page, which previews with an OG image and links back to the map.

## SEO, AEO and GEO

- Root `metadata` in `app/layout.tsx` sets `metadataBase`, a title template, canonical, Open Graph, Twitter, robots, icons and the manifest. City and place pages override title, description, canonical and Open Graph per route.
- Paginated city views (`?page=2`) canonicalise to page one so ranking signals stay on a single URL.
- JSON-LD marks coordinates with `additionalProperty: locationPrecision = approximate`, and carries the same disclaimer the UI shows. Do not remove it: the coordinates are city centroids plus jitter, and structured data that implies otherwise would be misleading.
- `src/lib/seo.ts` holds the pure title/description/JSON-LD helpers and is unit-tested in `tests/seo.test.ts`.

### Sitemap strategy

`/sitemap.xml` is a **sitemap index**, not a urlset. ~12k places and a few hundred cities would fit in one file, but that would mean one large query per crawl and a full re-fetch whenever any row changes. The index points at:

| Child | Contents |
| --- | --- |
| `/sitemaps/core/sitemap.xml` | Home and the city directory. |
| `/sitemaps/cities/sitemap.xml` | One entry per distinct `city_slug`, capped at 2,000. |
| `/sitemaps/places/sitemap/N.xml` | Places, 5,000 per file (3 files today), from an id-ordered scan so chunk boundaries stay stable. |

`MAX_PLACE_CHUNKS` in `src/lib/sitemap.ts` caps the index at 50 chunks if the table ever grows far beyond its current size. If the count query fails, the index still advertises the core and city sitemaps rather than returning nothing.

## Brand assets

`public/` holds an SVG favicon, PNG icons (32, 180, 512) and the 1200x630 Open Graph image, plus `site.webmanifest`. The PNGs are drawn from primitives by `scripts/generate-assets.mjs` and committed, so the build needs no image toolchain and the repo carries no design exports:

```sh
node scripts/generate-assets.mjs
```

## Data and bounded APIs

- `GET /api/places?bbox=west,south,east,north&limit=600`: requires a valid bbox, defaults to 400 and caps at 600. West greater than east crosses the antimeridian.
- `GET /api/places/search?q=mumbai&limit=12`: searches name, city and address; requires 2–120 characters and caps at 40.
- `GET /api/places/:id`: one place by UUID. 400 on a malformed id, 404 when absent.
- `GET /api/cities/:citySlug`: aggregate for one city, including the mean of its listed coordinates for map centring.
- `src/lib/places.ts` also exposes `getPlaceById`, `listCities`, `countCities`, `getCity`, `findPlacesByCity`, `countPlaces` and `listPlaceRefs` for the server-rendered routes. Every one is parameterized and limit-clamped; none writes.
- Responses contain `places`, `total` (all matching rows) and `limit`. The count pill shows the viewport total; the sheet explains when only the top 600 are shown. Results are ordered by rating, reviews, then ID.
- Queries filter directly on non-null `places.lat` / `places.lng`, allowing the existing `places_lat_lng_idx` to serve viewport bounds. The server counts matches and only sends the capped selection to the client.
- Ops has populated all 11,957 coordinates with city centroids plus about 1–3 km of jitter. These are **approximate locations**, not verified restaurant coordinates. The UI asks visitors to confirm the address. There is no runtime centroid fallback or client-side jitter.
- `src/data/city_coords.json` is retained as a reference only; it is not imported into runtime code.
- SQL values are parameterized; search wildcard characters are escaped. API failures return generic errors without database details or credentials.

## Cloudflare deployment

Authenticate with `npx wrangler login`, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your shell/CI secret store. Use credentials authorized to deploy Workers.

```sh
npm run build
npx wrangler secret put DATABASE_URL
npm run deploy
```

Enter the existing Neon connection string at Wrangler's secret prompt. If Wrangler asks to create the named Worker before its first deployment, accept. The generated Worker name is `halalfood-world`; `npm run deploy` invokes `@vinext/cloudflare` against `dist/server/wrangler.json`. Equivalent:

```sh
npx @vinext/cloudflare deploy --config dist/server/wrangler.json
```

Wrangler prints the workers.dev URL on success. Configure the custom domain `halalfood.world` in Cloudflare after deployment if desired. Local `.dev.vars` does **not** upload production secrets. The only app secret is `DATABASE_URL`; no tile token is needed. Deployment also requires Cloudflare authentication.

The framework deployment setup follows the [official vinext documentation](https://github.com/cloudflare/vinext). Basemap availability depends on CARTO; review its service terms before scaling traffic.
