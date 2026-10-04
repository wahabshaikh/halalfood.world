import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readWorkerEnv } from "../src/lib/worker-env";

test("worker env falls back to a dynamic process.env lookup", async () => {
  const key = "TURNSTILE_SITE_KEY";
  const previous = process.env[key];
  process.env[key] = "  runtime-site-key  ";
  try {
    assert.equal(await readWorkerEnv(key), "runtime-site-key");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("login does not inline the Turnstile site key at build time", () => {
  const page = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  const turnstile = readFileSync(new URL("../src/lib/turnstile.ts", import.meta.url), "utf8");
  assert.equal(page.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(turnstile.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(turnstile.includes("process.env.TURNSTILE_SECRET_KEY"), false);
  assert.match(page, /readWorkerEnv\("TURNSTILE_SITE_KEY"\)/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
});
