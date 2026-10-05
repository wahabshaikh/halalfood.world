import { readFileSync, writeFileSync } from "node:fs";
import {
  applyPreviewEnvironment,
  applyPreviewRateLimitNamespaces,
  enforcePreviewSecretBoundary,
  PREVIEW_R2_BUCKET,
  PRODUCTION_D1_ID,
  ROLLBACK_D1_ID,
  PRODUCTION_R2_BUCKET,
  R2_BINDING,
} from "../apps/web/src/lib/preview-bindings.ts";
import { readProductionSecretNames } from "./read-production-secret-names.ts";

const path = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
const binding = config.d1_databases?.find(
  (db: { binding?: string }) => db.binding === "DB",
);
if (!binding) {
  throw new Error("Generated wrangler config has no DB binding to rebind for preview");
}
if (process.env.D1_DATABASE_ID === PRODUCTION_D1_ID || process.env.D1_DATABASE_ID === ROLLBACK_D1_ID) {
  throw new Error("Refusing to bind the preview upload to the production D1 database");
}
binding.database_name = process.env.D1_DATABASE_NAME;
binding.database_id = process.env.D1_DATABASE_ID;

const bucket = config.r2_buckets?.find(
  (entry: { binding?: string }) => entry.binding === R2_BINDING,
);
if (!bucket) {
  throw new Error("Generated wrangler config has no evidence bucket to rebind for preview");
}
bucket.bucket_name = PREVIEW_R2_BUCKET;
if (bucket.bucket_name === PRODUCTION_R2_BUCKET) {
  throw new Error("Refusing to bind the preview upload to the production R2 bucket");
}
applyPreviewEnvironment(config);
// The build copied the production rate-limit namespaces into this config.
// Preview traffic must not count against the live Google search limits.
applyPreviewRateLimitNamespaces(config);
const secretNames = readProductionSecretNames();
enforcePreviewSecretBoundary(config, secretNames);
writeFileSync(path, JSON.stringify(config));
console.log(
  `Preview bindings: D1 ${binding.database_name} (${binding.database_id}), R2 ${bucket.bucket_name}, ENVIRONMENT=preview, rate limits ${(config.ratelimits ?? []).map((entry: { name?: string; namespace_id?: string }) => `${entry.name}=${entry.namespace_id}`).join(" ") || "none"}. ${secretNames.length} production secret names were not set as vars.`,
);
