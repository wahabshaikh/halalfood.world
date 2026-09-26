# Map

The map is a full-height MapLibre view of places that have coordinates, with a list beside it on a wide window.

## Sub-features

- List region named `Places in this area`. Its heading is `{n} places in this area`, `{1} place in this area`, `Finding places…`, or `Places unavailable`.
- Map canvas named `Map of halal places`.
- Controls named `Zoom in`, `Zoom out`, and `Find my location`, inside the group `Map controls`.
- Filter chips in the group `Filter halal places`, including a `Filters` button that opens a dialog titled `Filters`, a `My standards` chip, and status chips `Verified halal`, `Community verified`, `Halal options`, `Self declared halal`, `Unverified`, and `Not halal`.
- Place tiles in the list, and marker buttons whose accessible name is the place name, when the viewport contains places.
- Empty copy: `No places here yet. Try moving the map or zooming out.`

## How to get to it (user POV)

Choose `Map` in the `Explore` tabs, the footer, or the header menu. Search results also offer `Show map`. Old home-page links `/?place=`, `/?city=`, and `/?lat=&lng=&z=` redirect to `/map` with the same query.

## Driving it with Playwright

```js
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(base + "/map");
await page.getByRole("region", { name: "Places in this area" }).waitFor();
await page.getByRole("button", { name: "Zoom in" }).waitFor();
await page.getByRole("button", { name: "Filters" }).click();
await page.getByRole("dialog").getByRole("heading", { name: "Filters" }).waitFor();
```

The list is filled from `GET /api/discover?bbox=west,south,east,north&limit=600`. Capture that response while the map loads. Its `total` is the number in the heading. With no visitor location the camera is Mumbai at zoom 12 (`DEFAULT_MAP_VIEW`), and the three Mumbai fixtures are in view. When workerd attaches a distant `request.cf` location, the map opens on the nearest seeded city instead (Ashburn opens Manchester, on This and That and Mughli). Click the marker button named with the first place in that response. The region `Selected place` appears and the URL becomes `/map?place=<that place id>`. `0 places in this area` means the seed is missing or the camera is not on a seeded city.

`Find my location` calls the browser geolocation API. In an automated context with no permission, the page shows a status `Location is turned off. Try searching for your city.` or `This browser can’t share your location. Try searching for a city.` Do not grant a fake coordinate through an internal setter; deny the permission and read that status.

## Gotchas

- `tests/browser-smoke.mjs` clicks `.rating-marker` and `.map-selected`. Markers are now buttons named with the place name, and the selected card is the region `Selected place` with a `Close` button. Those old classes are not in the page.
- The map canvas is created by MapLibre after JavaScript runs. A curl of `/map` contains the shell; the heading text arrives only in the browser.
- The dev server has no tile token. Basemap tiles come from CARTO. A failed tile request does not by itself mean the place list failed; judge the list heading and `/api/places`.
- Below 900px the list and the map are toggled. Drive the list at 1440×1000 so `Places in this area` stays visible.
- A marker button can sit under the sticky header, so a coordinate click hits the header. Call `click()` on the button named with the place name. The selection still updates `Selected place` and `/map?place=`.
