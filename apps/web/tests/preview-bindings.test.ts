import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyPreviewEnvironment,
  applyPreviewRateLimitNamespaces,
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
  previewIsolationDecision,
  productionSecretNamesFromCommand,
  shadowedProductionSecrets,
  enforcePreviewSecretBoundary,
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

test("preview secret names come from wrangler secret list and cannot drift", () => {
  const listed = JSON.stringify(
    [
      { name: "RESEND_API_KEY", type: "secret_text" },
      { name: "BRAND_NEW_SECRET", type: "secret_text" },
    ],
    null,
    2,
  );
  const secretNames = productionSecretNamesFromCommand({
    status: 0,
    stdout: `\n${listed}\n`,
    stderr: "",
  });
  assert.deepEqual(secretNames, ["RESEND_API_KEY", "BRAND_NEW_SECRET"]);
  assert.deepEqual(shadowedProductionSecrets(secretNames, PREVIEW_UPLOAD_VAR_NAMES), []);

  const config: PreviewWranglerConfig = {
    vars: {
      BETTER_AUTH_URL: "https://pr.example",
      ENVIRONMENT: "preview",
      RESEND_API_KEY: "must-not-upload",
      BRAND_NEW_SECRET: "must-not-upload",
      SENTRY_DSN: "https://dsn.example",
    },
  };
  enforcePreviewSecretBoundary(config, secretNames);
  assert.equal(config.vars?.RESEND_API_KEY, undefined);
  assert.equal(config.vars?.BRAND_NEW_SECRET, undefined);
  assert.equal(config.vars?.BETTER_AUTH_URL, "https://pr.example");
  assert.equal(config.vars?.ENVIRONMENT, PREVIEW_ENVIRONMENT);
  assert.equal(config.vars?.SENTRY_DSN, "https://dsn.example");
});

test("preview build fails when a preview var shadows a listed production secret", () => {
  assert.throws(
    () => enforcePreviewSecretBoundary({ vars: { ENVIRONMENT: "preview" } }, ["ENVIRONMENT"]),
    /shadow production secrets \(ENVIRONMENT\)/,
  );
  assert.throws(
    () =>
      productionSecretNamesFromCommand({
        status: 1,
        stdout: "",
        stderr: "Authentication error",
      }),
    /Refusing to build the preview/,
  );
  assert.throws(
    () =>
      productionSecretNamesFromCommand({
        status: null,
        stdout: "",
        stderr: "",
        error: { code: "ETIMEDOUT", message: "timed out" },
      }),
    /timed out/,
  );
  assert.throws(
    () => productionSecretNamesFromCommand({ status: 0, stdout: "not json", stderr: "" }),
    /JSON array/,
  );
});

test("preview workflow and binders do not inject TURNSTILE_SITE_KEY", () => {
  const root = new URL("../../../", import.meta.url);
  const workflow = readFileSync(new URL(".github/workflows/preview.yml", root), "utf8");
  const binder = readFileSync(new URL("scripts/bind-github-preview.ts", root), "utf8");
  const stage = readFileSync(new URL("scripts/stage-cloudflare-build.ts", root), "utf8");
  assert.equal(workflow.includes("secrets.TURNSTILE_SITE_KEY"), false);
  assert.equal(workflow.includes("applyTurnstileSiteKey"), false);
  const varFlags = [...workflow.matchAll(/--var "([^:]+):/g)].map((match) => match[1]);
  assert.deepEqual(varFlags, [...PREVIEW_UPLOAD_VAR_NAMES]);
  assert.equal(binder.includes("applyTurnstileSiteKey"), false);
  assert.equal(binder.includes("process.env.TURNSTILE_SITE_KEY"), false);
  assert.equal(binder.includes("TURNSTILE_SITE_KEY:"), false);
  assert.equal(binder.includes("PRODUCTION_SECRET_NAMES"), false);
  assert.equal(stage.includes("applyTurnstileSiteKey"), false);
  assert.equal(stage.includes("PRODUCTION_SECRET_NAMES"), false);
  assert.match(binder, /readProductionSecretNames/);
  assert.match(binder, /enforcePreviewSecretBoundary/);
  assert.match(stage, /readProductionSecretNames/);
  assert.match(stage, /enforcePreviewSecretBoundary/);
  const reader = readFileSync(new URL("scripts/read-production-secret-names.ts", root), "utf8");
  assert.match(reader, /wrangler", "secret", "list"/);
  assert.match(reader, /--format", "json"/);
  assert.equal(reader.includes("secret put"), false);
  assert.equal(reader.includes("secret delete"), false);
  // The GitHub bind step lists production secret names, so it needs the token.
  const bindStep = workflow.slice(
    workflow.indexOf("- name: Bind preview D1 and R2"),
    workflow.indexOf("- name: Upload Cloudflare preview"),
  );
  assert.match(bindStep, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(bindStep, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(bindStep, /scripts\/bind-github-preview\.ts/);
  assert.match(stage, /copyGoogleSearchWorkerConfig/);
  assert.match(binder, /applyPreviewRateLimitNamespaces\(config\)/);
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

test("a preview rate limit left on a production namespace refuses the upload", () => {
  assert.throws(
    () =>
      applyPreviewRateLimitNamespaces({
        ratelimits: [{ name: "SOME_NEW_LIMIT", namespace_id: "81001", simple: { limit: 1, period: 60 } }],
      }),
    /share production namespaces/,
  );
  const config: PreviewWranglerConfig = {
    ratelimits: [
      { name: "GOOGLE_SEARCH_ANON", namespace_id: "81001" },
      { name: "GOOGLE_SEARCH_USER", namespace_id: "81002" },
    ],
  };
  applyPreviewRateLimitNamespaces(config);
  assert.deepEqual(
    config.ratelimits?.map((entry) => entry.namespace_id),
    ["81101", "81102"],
  );
});
