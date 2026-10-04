import { readFileSync, writeFileSync } from "node:fs";
import {
  applyPreviewEnvironment,
  applyTurnstileSiteKey,
  PREVIEW_R2_BUCKET,
  PRODUCTION_D1_ID,
  PRODUCTION_R2_BUCKET,
  R2_BINDING,
} from "../apps/web/src/lib/preview-bindings.ts";

const path = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
const binding = config.d1_databases?.find(
  (db: { binding?: string }) => db.binding === "DB",
);
if (!binding) {
  throw new Error("Generated wrangler config has no DB binding to rebind for preview");
}
if (process.env.D1_DATABASE_ID === PRODUCTION_D1_ID) {
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
applyTurnstileSiteKey(config, process.env.TURNSTILE_SITE_KEY);
writeFileSync(path, JSON.stringify(config));
console.log(
  `Preview bindings: D1 ${binding.database_name} (${binding.database_id}), R2 ${bucket.bucket_name}, ENVIRONMENT=preview`,
);
