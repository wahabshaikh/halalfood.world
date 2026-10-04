import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyPreviewEnvironment,
  applyPreviewResourceBindings,
  copyGoogleSearchWorkerConfig,
  PREVIEW_D1_ID,
  PREVIEW_D1_NAME,
  PREVIEW_ENVIRONMENT,
  PREVIEW_UPLOAD_VAR_NAMES,
  type PreviewWranglerConfig,
  PREVIEW_R2_BUCKET,
  PRODUCTION_D1_ID,
  PRODUCTION_R2_BUCKET,
  PRODUCTION_SECRET_NAMES,
  previewIsolationDecision,
  previewVarReplacesProductionSecret,
  stripProductionSecretVars,
} from "../src/lib/preview-bindings";

test("only a named non-main Workers Builds branch is isolated", () => {
  assert.equal(previewIsolationDecision({}), "production");
  assert.equal(
    previewIsolationDecision({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }),
    "production",
  );
  assert.equal(previewIsolationDecision({ WORKERS_CI: "1" }), "refuse");
  assert.equal(
    previewIsolationDecision({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "cursor/preview-isolation-c883" }),
    "preview",
  );
});

test("preview bindings replace the production database and bucket", () => {
  const config = {
    name: "halalfood-world",
    d1_databases: [
      {
        binding: "DB",
        database_name: "halalfood-world",
        database_id: PRODUCTION_D1_ID,
      },
    ],
    r2_buckets: [{ binding: "HALAL_EVIDENCE_R2", bucket_name: PRODUCTION_R2_BUCKET }],
  };

  applyPreviewResourceBindings(config);

  assert.equal(config.d1_databases[0].database_name, PREVIEW_D1_NAME);
  assert.equal(config.d1_databases[0].database_id, PREVIEW_D1_ID);
  assert.notEqual(config.d1_databases[0].database_id, PRODUCTION_D1_ID);
  assert.equal(config.r2_buckets[0].bucket_name, PREVIEW_R2_BUCKET);
  assert.equal(config.name, "halalfood-world");
});

test("preview uploads set ENVIRONMENT to preview", () => {
  const config: PreviewWranglerConfig = { vars: { BETTER_AUTH_URL: "https://example.test" } };
  applyPreviewEnvironment(config);
  assert.equal(config.vars?.ENVIRONMENT, PREVIEW_ENVIRONMENT);
  assert.equal(config.vars?.BETTER_AUTH_URL, "https://example.test");
});

test("preview uploads do not set a var named like a production secret", () => {
  for (const name of PREVIEW_UPLOAD_VAR_NAMES) {
    assert.equal(previewVarReplacesProductionSecret(name), false, name);
  }
  for (const name of PRODUCTION_SECRET_NAMES) {
    assert.equal(previewVarReplacesProductionSecret(name), true, name);
  }
  const config: PreviewWranglerConfig = {
    vars: {
      BETTER_AUTH_URL: "https://pr.example",
      ENVIRONMENT: "preview",
      TURNSTILE_SITE_KEY: "must-not-upload",
      TURNSTILE_SECRET_KEY: "must-not-upload",
      BETTER_AUTH_SECRET: "must-not-upload",
      RESEND_API_KEY: "must-not-upload",
      GOOGLE_PLACES_API_KEY: "must-not-upload",
      GOOGLE_MAPS_API_KEY: "must-not-upload",
      EMAIL_HEALTHCHECK_TOKEN: "must-not-upload",
      SENTRY_DSN: "https://dsn.example",
    },
  };
  stripProductionSecretVars(config);
  applyPreviewEnvironment(config);
  assert.equal(config.vars?.TURNSTILE_SITE_KEY, undefined);
  assert.equal(config.vars?.TURNSTILE_SECRET_KEY, undefined);
  assert.equal(config.vars?.BETTER_AUTH_SECRET, undefined);
  assert.equal(config.vars?.RESEND_API_KEY, undefined);
  assert.equal(config.vars?.GOOGLE_PLACES_API_KEY, undefined);
  assert.equal(config.vars?.GOOGLE_MAPS_API_KEY, undefined);
  assert.equal(config.vars?.EMAIL_HEALTHCHECK_TOKEN, undefined);
  assert.equal(config.vars?.BETTER_AUTH_URL, "https://pr.example");
  assert.equal(config.vars?.ENVIRONMENT, PREVIEW_ENVIRONMENT);
  assert.equal(config.vars?.SENTRY_DSN, "https://dsn.example");
});

test("preview workflow and binders do not inject TURNSTILE_SITE_KEY", () => {
  const root = new URL("../../../", import.meta.url);
  const workflow = readFileSync(new URL(".github/workflows/preview.yml", root), "utf8");
  const binder = readFileSync(new URL("scripts/bind-github-preview.ts", root), "utf8");
  const stage = readFileSync(new URL("scripts/stage-cloudflare-build.ts", root), "utf8");
  assert.equal(workflow.includes("secrets.TURNSTILE_SITE_KEY"), false);
  assert.equal(workflow.includes("applyTurnstileSiteKey"), false);
  const varFlags = [...workflow.matchAll(/--var "([^:]+):/g)].map((match) => match[1]);
  assert.deepEqual(varFlags, ["BETTER_AUTH_URL", "ENVIRONMENT"]);
  for (const name of varFlags) assert.equal(previewVarReplacesProductionSecret(name), false);
  assert.equal(binder.includes("applyTurnstileSiteKey"), false);
  assert.equal(binder.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(binder.includes("TURNSTILE_SITE_KEY:"), false);
  assert.equal(stage.includes("applyTurnstileSiteKey"), false);
  assert.match(binder, /stripProductionSecretVars/);
  assert.match(stage, /stripProductionSecretVars/);
  assert.match(stage, /copyGoogleSearchWorkerConfig/);
});

test("preview uploads do not share the production Google search rate-limit namespaces", () => {
  const generated: PreviewWranglerConfig = { vars: { BETTER_AUTH_URL: "https://halalfood.world" } };
  copyGoogleSearchWorkerConfig(generated, {
    vars: { GOOGLE_SEARCH_DAILY_CAP: "1000" },
    ratelimits: [
      { name: "GOOGLE_SEARCH_ANON", namespace_id: "81001", simple: { limit: 5, period: 60 } },
      { name: "GOOGLE_SEARCH_USER", namespace_id: "81002", simple: { limit: 20, period: 60 } },
    ],
  });
  assert.equal(generated.vars?.GOOGLE_SEARCH_DAILY_CAP, "1000");
  assert.equal(generated.vars?.BETTER_AUTH_URL, "https://halalfood.world");
  const config = {
    d1_databases: [{ binding: "DB", database_name: "halalfood-world", database_id: PRODUCTION_D1_ID }],
    r2_buckets: [{ binding: "HALAL_EVIDENCE_R2", bucket_name: PRODUCTION_R2_BUCKET }],
    ratelimits: generated.ratelimits,
  };
  applyPreviewResourceBindings(config);
  assert.equal(config.ratelimits?.[0]?.namespace_id, "81101");
  assert.equal(config.ratelimits?.[1]?.namespace_id, "81102");
  assert.equal(config.ratelimits?.[1]?.simple?.limit, 20);
  assert.ok((config.ratelimits?.[1]?.simple?.limit ?? 0) > (config.ratelimits?.[0]?.simple?.limit ?? 0));
});
