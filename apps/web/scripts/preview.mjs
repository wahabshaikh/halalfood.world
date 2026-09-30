#!/usr/bin/env node
// Pull request preview helper for the Cloudflare Worker.
//
//   node scripts/preview.mjs setup    # after `npm run build`, before upload
//   node scripts/preview.mjs cleanup  # when the pull request closes
//
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PR_NUMBER.
// `setup` also appends preview_url, alias, d1_name to $GITHUB_OUTPUT.
//
// Every preview gets its own D1 database (halalfood-world-pr-<n>) and shares
// one preview R2 bucket, so a preview can never read or write production data.
// Secrets are inherited from the production Worker by `wrangler versions upload`.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const GENERATED_CONFIG = `${APP_DIR}dist/server/wrangler.json`;
const SOURCE_CONFIG = `${APP_DIR}wrangler.jsonc`;

export const PREVIEW_R2_BUCKET = "halalfood-world-evidence-preview";

export function previewNames(workerName, prNumber) {
  return {
    alias: `pr-${prNumber}`,
    d1Name: `${workerName}-pr-${prNumber}`,
    versionMessage: `PR #${prNumber}`,
  };
}

/** Point the generated config's D1 and R2 bindings at preview resources. */
export function rebindForPreview(config, { d1Name, d1Id, r2Bucket }) {
  const next = structuredClone(config);
  const d1 = next.d1_databases?.find((db) => db.binding === "DB");
  if (!d1) throw new Error("Generated wrangler config has no DB binding");
  d1.database_name = d1Name;
  d1.database_id = d1Id;
  delete d1.preview_database_id;
  for (const bucket of next.r2_buckets ?? []) {
    bucket.bucket_name = r2Bucket;
    delete bucket.preview_bucket_name;
  }
  return next;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function workerName() {
  // wrangler.jsonc allows comments; strip line comments before parsing.
  const raw = readFileSync(SOURCE_CONFIG, "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(raw).name;
}

function cloudflare() {
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  const account = encodeURIComponent(requireEnv("CLOUDFLARE_ACCOUNT_ID"));
  return async function api(path, { method = "GET", body, allow404 = false } = {}) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (allow404 && response.status === 404) return null;
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Cloudflare ${method} ${path} returned non-JSON (${response.status})`);
    }
    if (!response.ok || payload.success !== true) {
      throw new Error(`Cloudflare ${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
    }
    return payload;
  };
}

async function findD1(api, name) {
  const { result } = await api(`/d1/database?name=${encodeURIComponent(name)}`);
  return result?.find((db) => db.name === name) ?? null;
}

async function setup() {
  const api = cloudflare();
  const names = previewNames(workerName(), requireEnv("PR_NUMBER"));

  let d1 = await findD1(api, names.d1Name);
  if (!d1) {
    d1 = (await api("/d1/database", { method: "POST", body: { name: names.d1Name } })).result;
    console.log(`Created D1 database ${names.d1Name}`);
  } else {
    console.log(`Reusing D1 database ${names.d1Name}`);
  }

  const bucket = await api(`/r2/buckets/${PREVIEW_R2_BUCKET}`, { allow404: true });
  if (!bucket) {
    await api("/r2/buckets", { method: "POST", body: { name: PREVIEW_R2_BUCKET } });
    console.log(`Created R2 bucket ${PREVIEW_R2_BUCKET}`);
  }

  const { result: subdomain } = await api("/workers/subdomain");
  const config = JSON.parse(readFileSync(GENERATED_CONFIG, "utf8"));
  const previewUrl = `https://${names.alias}-${config.name}.${subdomain.subdomain}.workers.dev`;

  writeFileSync(
    GENERATED_CONFIG,
    JSON.stringify(
      rebindForPreview(config, { d1Name: names.d1Name, d1Id: d1.uuid, r2Bucket: PREVIEW_R2_BUCKET }),
    ),
  );
  console.log(`Preview URL: ${previewUrl}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `preview_url=${previewUrl}\nalias=${names.alias}\nd1_name=${names.d1Name}\nversion_message=${names.versionMessage}\n`,
    );
  }
}

async function cleanup() {
  const api = cloudflare();
  const worker = workerName();
  const names = previewNames(worker, requireEnv("PR_NUMBER"));

  const versions = [];
  for (let page = 1; ; page += 1) {
    const payload = await api(
      `/workers/workers/${encodeURIComponent(worker)}/versions?page=${page}&per_page=100`,
      { allow404: true },
    );
    if (!payload) break;
    versions.push(...payload.result);
    if (payload.result.length < 100) break;
  }
  const ours = versions.filter(
    (version) => version.annotations?.["workers/message"] === names.versionMessage,
  );
  for (const version of ours) {
    await api(`/workers/workers/${encodeURIComponent(worker)}/versions/${version.id}`, {
      method: "DELETE",
      allow404: true,
    });
  }
  console.log(`Deleted ${ours.length} preview version(s) for ${names.versionMessage}`);

  const d1 = await findD1(api, names.d1Name);
  if (d1) {
    await api(`/d1/database/${d1.uuid}`, { method: "DELETE" });
    console.log(`Deleted D1 database ${names.d1Name}`);
  } else {
    console.log(`D1 database ${names.d1Name} is already gone`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const run = { setup, cleanup }[command];
  if (!run) {
    console.error("Usage: node scripts/preview.mjs <setup|cleanup>");
    process.exit(2);
  }
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
