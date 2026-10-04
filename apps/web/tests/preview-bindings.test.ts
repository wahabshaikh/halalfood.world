import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPreviewResourceBindings,
  applyTurnstileSiteKey,
  PREVIEW_D1_ID,
  PREVIEW_D1_NAME,
  PREVIEW_R2_BUCKET,
  PRODUCTION_D1_ID,
  PRODUCTION_R2_BUCKET,
  previewIsolationDecision,
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

test("an empty Turnstile site key does not clear an existing var", () => {
  const config = { vars: { TURNSTILE_SITE_KEY: "already-set" } };
  applyTurnstileSiteKey(config, "  ");
  assert.equal(config.vars.TURNSTILE_SITE_KEY, "already-set");
  applyTurnstileSiteKey(config, " 0x-public ");
  assert.equal(config.vars.TURNSTILE_SITE_KEY, "0x-public");
});
