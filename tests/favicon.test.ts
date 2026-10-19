import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";

// /favicon.ico is a static asset (a PNG, which every browser accepts under .ico). It used to be a route that
// 308'd to /favicon-32.png, but the Workers cache layer followed that redirect in a loop ("Too many redirects",
// error 1101) in production.
test("/favicon.ico is a static asset, not a route", () => {
  const icon = readFileSync(new URL("../public/favicon.ico", import.meta.url));
  assert.deepEqual([...icon.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(existsSync(new URL("../app/favicon.ico", import.meta.url)), false);
});
