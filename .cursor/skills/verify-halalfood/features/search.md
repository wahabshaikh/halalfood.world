# Search

Search looks up halal places and cities by name. The header form is a real GET to `/search`.

## Sub-features

- Header search box, labelled `Search halal places or cities`, placeholder `Search places or cities`, submitted by the button named `Search`.
- Results heading `Halal places matching “…”` (curly quotes U+201C and U+201D) and a count line.
- Matching city chips in the navigation named `Matching cities`, linking to `/city/<slug>`.
- A grid of place tiles linking to `/place/<uuid>` when there are matches.
- Empty state: the count line says `No places found yet`, then a panel titled `Know “…”?` with a link `Add “…”` to `/add?q=…`.
- `Show map` link to `/map`.

## How to get to it (user POV)

From any page with the header, type a restaurant, dish, or city into the search pill and press the round search button. A query shorter than two characters opens `/search` with the heading `What are you craving?` and does not run a lookup.

## Driving it with Playwright

The script `scripts/drive-search.mjs` does this for the query `london`. The same steps:

```js
await page.goto(base + "/");
await page.getByRole("searchbox", { name: "Search halal places or cities" }).fill("london");
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.waitForURL(/\/search\?q=london/);
await page.getByRole("heading", { level: 1, name: "Halal places matching \u201clondon\u201d" }).waitFor();
```

Prove the result against the places search API, not a client setter. The handler caps `limit` at 40, so a request for 48 comes back with `"limit": 40`:

```
GET /api/places/search?q=london&limit=48
```

On the verification database `total` is 4, `limit` is 40, the first place is Dishoom King's Cross, and the page says `4 places` with at least four `/place/` links. The matching-cities navigation includes London. This path must not POST, and it must not request `places.googleapis.com` or `maps.googleapis.com`. Search reads local D1. Place pages in this environment read the seeded snapshot and do not call Google.

## Gotchas

- The count line does not say `0 places`. Zero is the sentence `No places found yet`. The seeded server must not show that sentence for `london`.
- Each place tile has two anchors (the photo and the name), so four London places produce eight `a[href^="/place/"]` nodes. Judge the API `total` and the `4 places` line, not the raw anchor count.
- `scripts/drive-features.mjs` is the seeded proof and writes `evidence/e2e/`. `scripts/drive-search.mjs` writes `evidence/search-*` and will replace an older recording there.
- SQL wildcards are literal. `q=%25%25` returns `total: 0`.
- Queries of one character are rejected by the API with 400 and by the page, which shows `What are you craving?` instead of results.
