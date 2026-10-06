import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { isPreviewHost } from "./request-host";
import {
  isPreviewDeployment,
  readWorkerEnv,
  TURNSTILE_PREVIEW_SECRET_KEY,
  TURNSTILE_PREVIEW_SITE_KEY,
} from "./worker-env";

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

test("preview versions on workers.dev use Turnstile test keys even when BETTER_AUTH_URL is production", async () => {
  const previous = {
    ENVIRONMENT: process.env.ENVIRONMENT,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };
  process.env.ENVIRONMENT = "preview";
  process.env.BETTER_AUTH_URL = "https://halalfood.world";
  process.env.TURNSTILE_SITE_KEY = "production-site-secret";
  process.env.TURNSTILE_SECRET_KEY = "production-server-secret";
  const previewHost = "pr-63-halalfood-world.wahabshaikh.workers.dev";
  try {
    assert.equal(isPreviewHost(previewHost), true);
    assert.equal(isPreviewHost(`${previewHost}:443`), true);
    assert.equal(await isPreviewDeployment(previewHost), true);
    assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", previewHost), TURNSTILE_PREVIEW_SITE_KEY);
    assert.equal(await readWorkerEnv("TURNSTILE_SECRET_KEY", previewHost), TURNSTILE_PREVIEW_SECRET_KEY);
    assert.equal(
      (await readWorkerEnv("TURNSTILE_SITE_KEY", previewHost)).includes("production-site-secret"),
      false,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the production Worker on its own workers.dev URLs keeps production Turnstile keys", async () => {
  const previous = {
    ENVIRONMENT: process.env.ENVIRONMENT,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };
  process.env.TURNSTILE_SITE_KEY = "production-site-secret";
  process.env.TURNSTILE_SECRET_KEY = "production-server-secret";
  const productionHosts = [
    "halalfood-world.wahabshaikh.workers.dev",
    "d9232e5d-halalfood-world.wahabshaikh.workers.dev",
  ];
  try {
    for (const environment of [undefined, "", "production", "Preview "]) {
      if (environment === undefined) delete process.env.ENVIRONMENT;
      else process.env.ENVIRONMENT = environment;
      for (const host of productionHosts) {
        assert.equal(isPreviewHost(host), true, host);
        assert.equal(await isPreviewDeployment(host), false, `${host} ${environment}`);
        assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", host), "production-site-secret", host);
        assert.equal(await readWorkerEnv("TURNSTILE_SECRET_KEY", host), "production-server-secret", host);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("halalfood.world keeps production Turnstile keys when ENVIRONMENT is preview", async () => {
  const previous = {
    ENVIRONMENT: process.env.ENVIRONMENT,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };
  process.env.ENVIRONMENT = "preview";
  process.env.BETTER_AUTH_URL = "https://pr-1-halalfood-world.wahabshaikh.workers.dev";
  process.env.TURNSTILE_SITE_KEY = "production-site-secret";
  process.env.TURNSTILE_SECRET_KEY = "production-server-secret";
  try {
    for (const host of ["halalfood.world", "www.halalfood.world", "HalalFood.World:443", "localhost:3000"]) {
      assert.equal(isPreviewHost(host), false, host);
      assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY", host), "production-site-secret", host);
      assert.equal(await readWorkerEnv("TURNSTILE_SECRET_KEY", host), "production-server-secret", host);
    }
    assert.equal(await readWorkerEnv("TURNSTILE_SITE_KEY"), "production-site-secret");
    assert.equal(isPreviewHost("workers.dev"), false);
    assert.equal(isPreviewHost("notworkers.dev"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("login does not inline the Turnstile site key at build time", () => {
  const page = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  const turnstile = readFileSync(new URL("./turnstile.ts", import.meta.url), "utf8");
  const workerEnv = readFileSync(new URL("./worker-env.ts", import.meta.url), "utf8");
  const requestHost = readFileSync(new URL("./request-host.ts", import.meta.url), "utf8");
  assert.equal(page.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(turnstile.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(turnstile.includes("process.env.TURNSTILE_SECRET_KEY"), false);
  assert.match(page, /readWorkerEnv\("TURNSTILE_SITE_KEY", host\)/);
  assert.match(page, /headers\(\)/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.equal(workerEnv.includes("process.env.BETTER_AUTH_URL"), false);
  assert.equal(workerEnv.includes('readWorkerBinding("BETTER_AUTH_URL")'), false);
  assert.equal(requestHost.includes("process.env"), false);
  assert.match(workerEnv, /isPreviewHost\(host\)/);
  assert.match(workerEnv, /readWorkerBinding\("ENVIRONMENT"\)\) === PREVIEW_ENVIRONMENT_VALUE/);
});
