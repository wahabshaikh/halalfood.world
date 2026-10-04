import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);

test("the map canvas is sized by its parent, not by Tailwind absolute alone", () => {
  const view = readFileSync(new URL("apps/web/app/map/map-view.tsx", root), "utf8");
  const css = readFileSync(new URL("packages/ui/src/styles/globals.css", root), "utf8");
  const place = readFileSync(new URL("apps/web/app/place/[id]/page.tsx", root), "utf8");
  const city = readFileSync(new URL("apps/web/app/city/[citySlug]/page.tsx", root), "utf8");

  assert.match(view, /className=\{cn\(\s*"map-stage relative h-\[calc\(100vh-150px\)\]/);
  assert.match(view, /min-\[900px\]:h-full/);
  assert.equal(view.includes("min-[900px]:h-auto"), false);
  assert.match(view, /className="map-canvas absolute inset-0 size-full bg-map"/);
  assert.match(view, /height: "100%"/);
  assert.match(view, /absolute bottom-36 /);
  assert.match(view, /min-\[900px\]:bottom-7/);
  assert.match(view, /Show list/);
  const rule = css.slice(css.indexOf(".map-stage > .map-canvas.maplibregl-map"));
  assert.match(rule, /height:\s*100%;/);
  assert.match(rule, /position:\s*absolute;/);
  assert.match(place, /\/map\?place=/);
  assert.match(city, /\/map\?city=/);
  assert.equal(place.includes("maplibregl"), false);
  assert.equal(city.includes("maplibregl"), false);
});

test("map canvas height stays above 0 at 320, 768 and 1280", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    t.skip("playwright is not installed");
    return;
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch {
    t.skip("Chromium is not installed");
    return;
  }

  const css = readFileSync(new URL("packages/ui/src/styles/globals.css", root), "utf8");
  const rule = css.slice(css.indexOf(".map-stage > .map-canvas.maplibregl-map"));
  const html = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  .maplibregl-map { font: 12px/20px sans-serif; overflow: hidden; position: relative; }
  .maplibregl-canvas { position: absolute; left: 0; top: 0; }
  .shell { height: calc(100vh - 79px); }
  .map-stage { position: relative; height: calc(100vh - 150px); }
  @media (min-width: 900px) {
    .map-stage { height: 100%; min-height: 0; }
  }
  ${rule}
</style>
<div class="shell">
  <div class="map-stage">
    <div class="map-canvas maplibregl-map">
      <canvas class="maplibregl-canvas" width="2" height="2"></canvas>
    </div>
  </div>
</div>`;

  try {
    const page = await browser.newPage();
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(html);
      const height = await page.locator(".map-canvas").evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { height: box.height, position: style.position };
      });
      assert.equal(height.position, "absolute", `width ${width}`);
      assert.ok(height.height > 0, `width ${width} height ${height.height}`);
    }
    await page.close();
  } finally {
    await browser.close();
  }
});

test("the selected place card clears the Show list button at 320, 390 and 430", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    t.skip("playwright is not installed");
    return;
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch {
    t.skip("Chromium is not installed");
    return;
  }
  const page = await browser.newPage();
  try {
    const probe = await page.request.get("http://localhost:3000/map", { timeout: 3000 }).catch(() => null);
    if (!probe?.ok()) {
      t.skip("map dev server is not running");
      return;
    }
    await page.route("**/api/places/**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
          name: "Bademiya",
          street_address: "123 Tulloch Road, Colaba Causeway, near the gateway",
          address_locality: "Mumbai",
          city_slug: "mumbai",
          lat: 18.922,
          lng: 72.8347,
          rating_value: "4.2",
        }),
      }),
    );
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("http://localhost:3000/map?place=3f2504e0-4f89-11d3-9a0c-0305e82c3301", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("[aria-label='Selected place']", { timeout: 15000 });
      const overlap = await page.evaluate(() => {
        const card = document.querySelector("[aria-label='Selected place']");
        const button = [...document.querySelectorAll("button")].find((element) =>
          element.textContent?.includes("Show list"),
        );
        const address = card?.querySelectorAll("span")[1];
        if (!card || !button || !address) return { missing: true, overlap: true, addressBottom: 0, buttonTop: 0 };
        const cardBox = card.getBoundingClientRect();
        const buttonBox = button.getBoundingClientRect();
        const addressBox = address.getBoundingClientRect();
        const cardHits =
          !(cardBox.right < buttonBox.left || buttonBox.right < cardBox.left || cardBox.bottom < buttonBox.top || buttonBox.bottom < cardBox.top);
        const addressHits =
          !(addressBox.right < buttonBox.left || buttonBox.right < addressBox.left || addressBox.bottom < buttonBox.top || buttonBox.bottom < addressBox.top);
        return {
          missing: false,
          overlap: cardHits || addressHits,
          addressBottom: addressBox.bottom,
          buttonTop: buttonBox.top,
        };
      });
      assert.equal(overlap.missing, false, `width ${width}`);
      assert.equal(overlap.overlap, false, `width ${width} ${JSON.stringify(overlap)}`);
    }
  } finally {
    await browser.close();
  }
});
