# Explore

The home page is the first screen. It is a server-rendered list of halal places, grouped into rows, with a search box and category tabs.

## Sub-features

- Hero title and lead. With no visitor location (the local dev server sends none) the title is `Halal food you’ll love` (the apostrophe is U+2019).
- Header search. The same search box used by the search feature.
- Category tabs in the navigation named `Explore`: `Places to eat` (current), `Map`, `City guides`, `Community`.
- City chips in a navigation named `Cities near you` or `Popular cities`, plus an `All cities` chip, when the database has cities.
- Place rows. Each row is a section whose accessible name is the row title, such as `Closest to you` or `Top rated in London`. Tiles link to `/place/<uuid>`.

## How to get to it (user POV)

Open the site root. The header logo (`halalfood.world home`, desktop) and the footer link `Places to eat` both come back here. On a phone, the bottom navigation named `Main` has an `Explore` link to `/`.

## Driving it with Playwright

```js
await page.goto(base + "/");
await page.getByRole("searchbox", { name: "Search halal places or cities" }).waitFor();
await page.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Places to eat" }).waitFor();
const heading = page.getByRole("heading", { level: 1 });
```

A populated database also shows `page.getByRole("region", { name: "Closest to you" })` or a `Top rated in …` region, and tile links `a[href^="/place/"]`.

The read that proves the rows are the database, not a fixture, is `GET /api/places?bbox=-180,-90,180,90&limit=1`. Its `total` is the number of listed places with coordinates. When `total` is 0 the home page has no place-tile links.

## Gotchas

- `tests/browser-smoke.mjs` still waits for `.explore-hero h1` and `.place-row`. Those classes are gone. Use the roles above.
- The first request after `vinext dev` starts can return a Vite error overlay (`<title>Error</title>`) while the server reloads. Doctor must pass before you drive.
- `curl http://127.0.0.1:3000/` is connection refused. Use `http://localhost:3000`.
- An empty local database still renders the hero and the search box. That is a successful explore load, not the unavailable state. The unavailable copy is `Listings are taking a moment`, and it means D1 was not reachable.
