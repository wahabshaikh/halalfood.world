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

The end state on the seeded server is that heading plus `3 cities and counting`, and cards for London, Mumbai, and Manchester. Open the London card (`a[href="/city/london"]`). The city heading is `4 halal restaurants in London` and there are four `/place/` links. `GET /api/cities/london` returns `city_slug` `london` and `place_count` 4.

If the database is down, the page says `Listings are taking a moment` instead, which is a failed load. `0 cities and counting` means the seed is missing.

## Gotchas

- There is no `/api/cities` collection route. The directory is server-rendered. Check the sentence on the page, then a single city via `/api/cities/<slug>` once a card exists.
- `/city/Not A Slug` is a 400-class miss at the API (`GET /api/cities/Not%20A%20Slug` returns 400). The HTML route `/city/no-such-city-anywhere-at-all` is a 404.
- Do not treat `0 cities` as the unavailable state.
