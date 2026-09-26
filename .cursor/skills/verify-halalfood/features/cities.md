# Cities

The city directory lists every city that has halal places, largest first, and links into that city's listings.

## Sub-features

- Page heading `Halal food by city`.
- Lead line `{count} city` or `{count} cities` plus `and counting`.
- `Show the map` link to `/map` and `Read city guides` link to `/guides`.
- One card per city linking to `/city/<slug>`. The slug is lowercase kebab-case.
- A city page lists places (60 per page) and links each one to `/place/<uuid>`.

## How to get to it (user POV)

In the footer column `Explore`, choose `Cities`. On desktop, `Open menu` in the header also has a `Cities` item. From Explore, the chip `All cities` appears when the directory is not empty.

## Driving it with Playwright

```js
await page.goto(base + "/");
await page.getByRole("link", { name: "Cities", exact: true }).click();
await page.waitForURL(/\/cities$/);
await page.getByRole("heading", { level: 1, name: "Halal food by city" }).waitFor();
```

The end state is that heading plus the count sentence. On an empty local database the sentence is `0 cities and counting` and there are no `/city/` links. That count is rendered from D1. If the database is down, the page says `Listings are taking a moment` instead, which is a failed load.

When a city card exists, open it and expect a heading with the city name and at least one `a[href^="/place/"]`. `GET /api/cities/<slug>` returns the same `city_slug` and a `place_count` greater than 0.

## Gotchas

- There is no `/api/cities` collection route. The directory is server-rendered. Check the sentence on the page, then a single city via `/api/cities/<slug>` once a card exists.
- `/city/Not A Slug` is a 400-class miss at the API (`GET /api/cities/Not%20A%20Slug` returns 400). The HTML route `/city/no-such-city-anywhere-at-all` is a 404.
- Do not treat `0 cities` as the unavailable state.
