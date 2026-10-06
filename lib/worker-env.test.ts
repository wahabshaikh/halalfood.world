import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "vitest";
import {
  isNonProductionRequest,
  readWorkerEnv,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
} from "./worker-env";

const KEYS = ["ENVIRONMENT", "BETTER_AUTH_URL", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function productionSecrets(environment: string | undefined) {
  if (environment === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = environment;
  process.env.TURNSTILE_SITE_KEY = "production-site-secret";
  process.env.TURNSTILE_SECRET_KEY = "production-server-secret";
}

test("worker env falls back to a dynamic process.env lookup", async () => {
  process.env.TURNSTILE_SITE_KEY = "  runtime-site-key  ";
  assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY"), "runtime-site-key");
});

test("a Worker Preview uses Turnstile test keys even when BETTER_AUTH_URL is production", async () => {
  productionSecrets("preview");
  process.env.BETTER_AUTH_URL = "https://halalfood.world";
  const previewHost = "my-branch-halalfood-world.wahabshaikh.workers.dev";
  for (const host of [previewHost, `${previewHost}:443`]) {
    assert.equal(await isNonProductionRequest(host), true, host);
    assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", host), TURNSTILE_TEST_SITE_KEY);
    assert.equal(await readWorkerEnv("TURNSTILE_SECRET_KEY", host), TURNSTILE_TEST_SECRET_KEY);
  }
});

test("local development uses Turnstile test keys, so sign-in works without secrets", async () => {
  productionSecrets("production");
  for (const host of ["localhost:5173", "127.0.0.1:5173", "localhost"]) {
    assert.equal(await isNonProductionRequest(host), true, host);
    assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", host), TURNSTILE_TEST_SITE_KEY, host);
  }
});

test("the production Worker on its own workers.dev URLs keeps production Turnstile keys", async () => {
  const productionHosts = ["halalfood-world.wahabshaikh.workers.dev", "d9232e5d-halalfood-world.wahabshaikh.workers.dev"];
  for (const environment of [undefined, "", "production"]) {
    productionSecrets(environment);
    for (const host of productionHosts) {
      assert.equal(await isNonProductionRequest(host), false, `${host} ${environment}`);
      assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", host), "production-site-secret", host);
      assert.equal(await readWorkerEnv("TURNSTILE_SECRET_KEY", host), "production-server-secret", host);
    }
  }
});

test("halalfood.world keeps production Turnstile keys even if ENVIRONMENT says preview", async () => {
  productionSecrets("preview");
  for (const host of ["halalfood.world", "www.halalfood.world", "HalalFood.World:443"]) {
    assert.equal(await isNonProductionRequest(host), false, host);
    assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", host), "production-site-secret", host);
    assert.equal(await readWorkerEnv("TURNSTILE_SECRET_KEY", host), "production-server-secret", host);
  }
  assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY"), "production-site-secret");
  assert.equal(await isNonProductionRequest("workers.dev"), false);
  assert.equal(await isNonProductionRequest(""), false);
});

test("login does not inline the Turnstile site key at build time", () => {
  const page = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  const turnstile = readFileSync(new URL("./turnstile.ts", import.meta.url), "utf8");
  const workerEnv = readFileSync(new URL("./worker-env.ts", import.meta.url), "utf8");
  assert.equal(page.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(turnstile.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(turnstile.includes("process.env.TURNSTILE_SECRET_KEY"), false);
  assert.match(page, /readWorkerEnv\("TURNSTILE_SITE_KEY", host\)/);
  assert.match(page, /headers\(\)/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.equal(workerEnv.includes("process.env.BETTER_AUTH_URL"), false);
});
