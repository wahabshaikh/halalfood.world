// Non-production uploads must not use the production D1 database or R2 bucket.
// Workers Builds runs `npx wrangler versions upload` for every non-main branch,
// and that command publishes whatever bindings are in dist/server/wrangler.json.

export const PRODUCTION_BRANCH = "main";
export const PRODUCTION_D1_ID = "3e4b080f-0559-4235-9923-2d6e4dec528f";
export const PRODUCTION_D1_NAME = "halalfood-world";
export const PRODUCTION_R2_BUCKET = "halalfood-world-evidence";

export const PREVIEW_D1_ID = "c5d8e0ff-c001-48b8-8545-49861227c16f";
export const PREVIEW_D1_NAME = "halalfood-world-preview";
export const PREVIEW_R2_BUCKET = "halalfood-world-evidence-preview";

export const D1_BINDING = "DB";
export const R2_BINDING = "HALAL_EVIDENCE_R2";

if (PREVIEW_D1_ID === PRODUCTION_D1_ID || PREVIEW_R2_BUCKET === PRODUCTION_R2_BUCKET) {
  throw new Error("Preview resource ids must be different from production");
}

export type PreviewIsolation = "production" | "preview" | "refuse";

export function previewIsolationDecision(env: NodeJS.ProcessEnv): PreviewIsolation {
  if (env.WORKERS_CI !== "1") return "production";
  const branch = (env.WORKERS_CI_BRANCH ?? "").trim();
  if (branch === PRODUCTION_BRANCH) return "production";
  if (!branch) return "refuse";
  return "preview";
}

type D1Binding = {
  binding?: string;
  database_name?: string;
  database_id?: string;
};

type R2Binding = {
  binding?: string;
  bucket_name?: string;
};

export type PreviewWranglerConfig = {
  name?: string;
  d1_databases?: D1Binding[];
  r2_buckets?: R2Binding[];
  vars?: Record<string, string>;
};

/** Point the DB and evidence-bucket bindings at the shared preview resources. */
export function applyPreviewResourceBindings(config: PreviewWranglerConfig): PreviewWranglerConfig {
  const database = config.d1_databases?.find((entry) => entry.binding === D1_BINDING);
  if (!database) throw new Error("Wrangler config has no DB binding");
  database.database_name = PREVIEW_D1_NAME;
  database.database_id = PREVIEW_D1_ID;

  const bucket = config.r2_buckets?.find((entry) => entry.binding === R2_BINDING);
  if (!bucket) throw new Error("Wrangler config has no HALAL_EVIDENCE_R2 binding");
  bucket.bucket_name = PREVIEW_R2_BUCKET;
  return config;
}

/**
 * Copy a public Turnstile site key from the build environment into Worker vars.
 * An empty value is left untouched so a missing secret cannot blank the key.
 */
export function applyTurnstileSiteKey(
  config: PreviewWranglerConfig,
  siteKey: string | undefined,
): PreviewWranglerConfig {
  const value = siteKey?.trim();
  if (!value) return config;
  config.vars = { ...config.vars, TURNSTILE_SITE_KEY: value };
  return config;
}
