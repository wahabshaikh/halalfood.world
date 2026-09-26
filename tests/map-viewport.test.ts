import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MAP_VIEW,
  deepLinkKind,
  shouldLoadViewport,
} from "../src/lib/map-viewport";

test("city and place links are the only deep links that move the camera", () => {
  assert.equal(deepLinkKind(new URLSearchParams("city=london")), "city");
  assert.equal(deepLinkKind(new URLSearchParams("place=abc")), "place");
  assert.equal(deepLinkKind(new URLSearchParams("status=verified")), null);
  assert.equal(deepLinkKind(new URLSearchParams()), null);
});

test("a deep link defers the viewport query until the camera has moved", () => {
  assert.equal(shouldLoadViewport(null, false), true);
  assert.equal(shouldLoadViewport("city", false), false);
  assert.equal(shouldLoadViewport("place", false), false);
  assert.equal(shouldLoadViewport("city", true), true);
  assert.equal(shouldLoadViewport("place", true), true);
});

test("the opening zoom is wide enough to include a city, not one empty block", () => {
  assert.equal(DEFAULT_MAP_VIEW.zoom, 12);
  assert.deepEqual(DEFAULT_MAP_VIEW.center, [72.8777, 19.055]);
});
