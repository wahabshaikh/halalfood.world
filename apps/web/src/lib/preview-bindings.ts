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

function assertDistinct(left: string, right: string, label: string): void {
  if (left === right) throw new Error(`${label} must differ from production`);
}

assertDistinct(PREVIEW_D1_ID, PRODUCTION_D1_ID, "Preview D1 id");
assertDistinct(PREVIEW_R2_BUCKET, PRODUCTION_R2_BUCKET, "Preview R2 bucket");

export type PreviewIsolation = "production" | "preview" | "refuse";

export function previewIsolationDecision(env: {
  WORKERS_CI?: string;
  WORKERS_CI_BRANCH?: string;
}): PreviewIsolation {
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

export type RateLimitBindingConfig = {
  name?: string;
  namespace_id?: string;
  simple?: { limit?: number; period?: number };
};

export type PreviewWranglerConfig = {
  name?: string;
  d1_databases?: D1Binding[];
  r2_buckets?: R2Binding[];
  vars?: Record<string, string>;
  ratelimits?: RateLimitBindingConfig[];
};

export const PREVIEW_ENVIRONMENT = "preview";

/** Tag a preview upload so Sentry does not file it under production. */
export function applyPreviewEnvironment(config: PreviewWranglerConfig): PreviewWranglerConfig {
  config.vars = { ...config.vars, ENVIRONMENT: PREVIEW_ENVIRONMENT };
  return config;
}

/** Point the DB and evidence-bucket bindings at the shared preview resources. */
export function applyPreviewResourceBindings(config: PreviewWranglerConfig): PreviewWranglerConfig {
  const database = config.d1_databases?.find((entry) => entry.binding === D1_BINDING);
  if (!database) throw new Error("Wrangler config has no DB binding");
  database.database_name = PREVIEW_D1_NAME;
  database.database_id = PREVIEW_D1_ID;

  const bucket = config.r2_buckets?.find((entry) => entry.binding === R2_BINDING);
  if (!bucket) throw new Error("Wrangler config has no HALAL_EVIDENCE_R2 binding");
  bucket.bucket_name = PREVIEW_R2_BUCKET;
  applyPreviewRateLimitNamespaces(config);
  return config;
}

/**
 * Preview rate-limit counters must not share production namespace ids.
 * A shared namespace_id counts preview traffic against the live Google budget.
 */
export function applyPreviewRateLimitNamespaces(config: PreviewWranglerConfig): PreviewWranglerConfig {
  for (const entry of config.ratelimits ?? []) {
    if (entry.name === "GOOGLE_SEARCH_ANON") entry.namespace_id = "81101";
    if (entry.name === "GOOGLE_SEARCH_USER") entry.namespace_id = "81102";
  }
  return config;
}

/** Copy the Google search bindings from the source wrangler config onto a generated one. */
export function copyGoogleSearchWorkerConfig(
  target: PreviewWranglerConfig,
  source: PreviewWranglerConfig,
): PreviewWranglerConfig {
  if (source.ratelimits?.length) {
    target.ratelimits = source.ratelimits.map((entry) => ({
      name: entry.name,
      namespace_id: entry.namespace_id,
      simple: entry.simple ? { limit: entry.simple.limit, period: entry.simple.period } : undefined,
    }));
  }
  const cap = source.vars?.GOOGLE_SEARCH_DAILY_CAP;
  if (cap) target.vars = { ...target.vars, GOOGLE_SEARCH_DAILY_CAP: cap };
  return target;
}

export function parseWranglerJsonc(source: string): PreviewWranglerConfig {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as PreviewWranglerConfig;
}

/**
 * Secret names on the production Worker `halalfood-world`.
 *
 * A preview upload is a version of that same Worker. A plain text var whose
 * name matches one of these replaces the secret on that version and on every
 * later version, including main deploys. `TURNSTILE_SITE_KEY` is public to the
 * browser and is still stored as a secret for that reason.
 */
export const PRODUCTION_SECRET_NAMES = [
  "BETTER_AUTH_SECRET",
  "EMAIL_HEALTHCHECK_TOKEN",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
] as const;

/** Vars a preview upload may set. None of these are production secrets. */
export const PREVIEW_UPLOAD_VAR_NAMES = ["BETTER_AUTH_URL", "ENVIRONMENT"] as const;

const PRODUCTION_SECRET_NAME_SET = new Set<string>(PRODUCTION_SECRET_NAMES);

export function previewVarReplacesProductionSecret(name: string): boolean {
  return PRODUCTION_SECRET_NAME_SET.has(name);
}

/** Drop secret names from Wrangler vars before a version is uploaded. */
export function stripProductionSecretVars(config: PreviewWranglerConfig): PreviewWranglerConfig {
  if (!config.vars) return config;
  for (const name of PRODUCTION_SECRET_NAMES) delete config.vars[name];
  return config;
}
