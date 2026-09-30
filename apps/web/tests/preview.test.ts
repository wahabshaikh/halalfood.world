import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error -- plain ESM script without type declarations
import { PREVIEW_R2_BUCKET, previewNames, rebindForPreview } from "../scripts/preview.mjs";

const generated = {
  name: "halalfood-world",
  d1_databases: [
    {
      binding: "DB",
      database_name: "halalfood-world",
      database_id: "prod-id",
      migrations_dir: "../../migrations",
    },
  ],
  r2_buckets: [{ binding: "HALAL_EVIDENCE_R2", bucket_name: "halalfood-world-evidence" }],
};

test("preview names are derived from the worker and PR number", () => {
  assert.deepEqual(previewNames("halalfood-world", "42"), {
    alias: "pr-42",
    d1Name: "halalfood-world-pr-42",
    versionMessage: "PR #42",
  });
});

test("previews never keep a production D1 or R2 binding", () => {
  const rebound = rebindForPreview(generated, {
    d1Name: "halalfood-world-pr-42",
    d1Id: "preview-id",
    r2Bucket: PREVIEW_R2_BUCKET,
  });
  assert.deepEqual(rebound.d1_databases[0], {
    binding: "DB",
    database_name: "halalfood-world-pr-42",
    database_id: "preview-id",
    migrations_dir: "../../migrations",
  });
  assert.equal(rebound.r2_buckets[0].bucket_name, "halalfood-world-evidence-preview");
  assert.equal(generated.d1_databases[0].database_id, "prod-id", "input is not mutated");
});

test("every storage binding in wrangler.jsonc is covered by the preview rebinding", () => {
  const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(source);
  const storageKeys = [
    "kv_namespaces",
    "durable_objects",
    "queues",
    "hyperdrive",
    "vectorize",
    "services",
  ].filter((key) => key in config);
  assert.deepEqual(
    storageKeys,
    [],
    "New storage bindings need a preview resource in scripts/preview.mjs",
  );
  assert.deepEqual(
    config.d1_databases.map((db: { binding: string }) => db.binding),
    ["DB"],
  );
});
