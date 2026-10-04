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
