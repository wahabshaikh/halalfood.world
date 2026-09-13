# halalfood.world

A full-screen halal food map built with vinext, React, MapLibre GL, Drizzle and the Neon serverless HTTP driver, deployed as a Cloudflare Worker. The interface uses CARTO Positron with OpenStreetMap attribution.

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

## Data and bounded APIs

- `GET /api/places?bbox=west,south,east,north&limit=600`: requires a valid bbox, defaults to 400 and caps at 600. West greater than east crosses the antimeridian.
- `GET /api/places/search?q=mumbai&limit=12`: searches name, city and address; requires 2–120 characters and caps at 40.
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
