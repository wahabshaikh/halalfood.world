# Explore

The home page is the first screen. It is a server-rendered list of halal places, grouped into rows, with a search box and category tabs.

## Sub-features

- Hero title and lead. With no visitor location the title is `Halal food you’ll love` (the apostrophe is U+2019). Local workerd often attaches `request.cf` (in this environment, Ashburn), and then the title is `Halal food, wherever you go` because no seeded city is within 60 km. A visitor inside that radius sees `Halal food near {city}`.
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

After the verification seed, the first screen includes the region `Top rated in London` (four places) even when a distant visitor location reorders the rows. City chips show a distance when a location exists, and a place count when it does not. Open the Dishoom King's Cross tile. The place URL is `/place/10000000-0000-4000-8000-000000000001` and the page shows `Fixture snapshot, 5 Stable Street, London`, which is the stored snapshot rather than a live Google address.

`GET /api/places?bbox=-180,-90,180,90&limit=1` returns `total` 9. That is the seeded directory. `total` 0 means this server is not on `.run/persist`.

## Gotchas

- `tests/browser-smoke.mjs` still waits for `.explore-hero h1` and `.place-row`. Those classes are gone. Use the roles above.
- The first request after `vinext dev` starts can return a Vite error overlay (`<title>Error</title>`) while the server reloads. Doctor must pass before you drive.
- `curl http://127.0.0.1:3000/` is connection refused. Use `http://localhost:3000`.
- The unavailable copy is `Places are taking a moment to load`, and it means D1 was not reachable. A hero with no `Top rated in London` region means the seed is missing. Doctor treats that as not worth driving.
- `Closest to you` renders only when the visitor is within 60 km of a seeded city. Ashburn is not, so that row is absent here.
