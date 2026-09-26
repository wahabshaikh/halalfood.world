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

When `total` is 0, the page text contains `No places found yet` and there is no `/place/` link. When `total` is greater than 0, at least one `a[href^="/place/"]` is visible. This path must not POST, and it must not call `places.googleapis.com` (place text search is local D1; Google is only the add flow).

## Gotchas

- The count line does not say `0 places`. Zero is the sentence `No places found yet`.
- A fresh `npm run db:migrate:local` database is empty, so `london` correctly lands on that empty state. That still proves the form, the route, and the API agree.
- SQL wildcards are literal. `q=%25%25` returns `total: 0`.
- Queries of one character are rejected by the API with 400 and by the page, which shows `What are you craving?` instead of results.
