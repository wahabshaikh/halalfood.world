import assert from "node:assert/strict";
import { test } from "vitest";
import { parseJsonc, readWranglerConfig } from "./wrangler-config";

// Previews must never be able to read or write production data, send real mail or spend
// production's rate-limit budgets. These checks fail the build if wrangler.jsonc drifts.
const config = readWranglerConfig();
const previews = config.previews ?? {};

test("the deployment names its environment", () => {
  assert.equal(config.vars?.ENVIRONMENT, "production");
  assert.equal(previews.vars?.ENVIRONMENT, "preview");
});

test("previews bind their own D1 database", () => {
  assert.ok(config.d1_databases?.length);
  for (const database of config.d1_databases ?? []) {
    const preview = previews.d1_databases?.find((entry) => entry.binding === database.binding);
    assert.ok(preview, `previews.d1_databases is missing ${database.binding}`);
    assert.notEqual(preview.database_id, database.database_id, `${database.binding} shares a database with production`);
    assert.notEqual(preview.database_name, database.database_name);
  }
});

test("previews bind their own R2 buckets and KV namespaces", () => {
  for (const bucket of config.r2_buckets ?? []) {
    const preview = previews.r2_buckets?.find((entry) => entry.binding === bucket.binding);
    assert.ok(preview, `previews.r2_buckets is missing ${bucket.binding}`);
    assert.notEqual(preview.bucket_name, bucket.bucket_name, `${bucket.binding} shares a bucket with production`);
  }
  for (const namespace of config.kv_namespaces ?? []) {
    const preview = previews.kv_namespaces?.find((entry) => entry.binding === namespace.binding);
    assert.ok(preview, `previews.kv_namespaces is missing ${namespace.binding}`);
    assert.notEqual(preview.id, namespace.id, `${namespace.binding} shares a namespace with production`);
  }
});

test("previews count rate limits in their own namespaces", () => {
  const production = new Set((config.ratelimits ?? []).map((entry) => entry.namespace_id));
  for (const limit of config.ratelimits ?? []) {
    const preview = previews.ratelimits?.find((entry) => entry.name === limit.name);
    assert.ok(preview, `previews.ratelimits is missing ${limit.name}`);
    assert.equal(production.has(preview.namespace_id), false, `${limit.name} shares a namespace with production`);
  }
});

test("previews cannot send mail, enqueue jobs, take routes or run crons", () => {
  assert.equal(previews.send_email, undefined);
  assert.equal(previews.queues, undefined);
  assert.equal(previews.routes, undefined);
  assert.equal(previews.triggers, undefined);
});

test("parseJsonc keeps // inside strings and drops trailing commas", () => {
  assert.deepEqual(parseJsonc('{\n  // note\n  "url": "https://a.b/c", /* x */ "list": [1, 2,],\n}'), { url: "https://a.b/c", list: [1, 2] });
});
