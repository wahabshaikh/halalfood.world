import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  TURNSTILE_COMPACT_MAX_WIDTH,
  turnstileWidgetSize,
} from "./turnstile-size";

test("Turnstile uses the compact widget on narrow viewports", () => {
  for (const width of [320, 360, TURNSTILE_COMPACT_MAX_WIDTH]) {
    assert.equal(turnstileWidgetSize(width), "compact", String(width));
  }
  for (const width of [TURNSTILE_COMPACT_MAX_WIDTH + 1, 768, 1280]) {
    assert.equal(turnstileWidgetSize(width), "normal", String(width));
  }

  const form = readFileSync(new URL("../app/login/login-form.tsx", import.meta.url), "utf8");
  assert.match(form, /size,/);
  assert.match(form, /turnstileWidgetSize/);
  assert.match(form, /max-w-full/);
});
