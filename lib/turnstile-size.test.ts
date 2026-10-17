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

  // The widget is shared by sign-in and certifier alerts; both pick its size from the viewport.
  const widget = readFileSync(new URL("../components/hf/turnstile-check.tsx", import.meta.url), "utf8");
  assert.match(widget, /size,/);
  assert.match(widget, /max-w-full/);
  for (const path of ["../app/login/login-form.tsx", "../app/certifiers/alerts/alerts-form.tsx"]) {
    const form = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(form, /turnstileWidgetSize/, path);
    assert.match(form, /<TurnstileCheck/, path);
  }
});
