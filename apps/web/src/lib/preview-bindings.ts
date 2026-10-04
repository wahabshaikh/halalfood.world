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

export const PRODUCTION_WORKER_NAME = "halalfood-world";

/** Vars a preview upload may set. A preview build fails if any of these is a production secret. */
export const PREVIEW_UPLOAD_VAR_NAMES = ["BETTER_AUTH_URL", "ENVIRONMENT"] as const;

export const SECRET_LIST_TIMEOUT_MS = 60_000;

export type SecretListCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: { code?: string; message?: string } | null;
};

/**
 * `wrangler secret list --format json` prints an array of `{ name, type }`.
 * Names only: the command does not return secret values. Anything else fails
 * the preview build instead of falling back to a hardcoded name list.
 */
export function parseWranglerSecretList(output: string): string[] {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("wrangler secret list returned no secret names.");
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("wrangler secret list did not return a JSON array of secret names.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error("wrangler secret list did not return a JSON array of secret names.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("wrangler secret list did not return a JSON array of secret names.");
  }
  const names: string[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string") {
      throw new Error("wrangler secret list entry is missing a name.");
    }
    const name = (entry as { name: string }).name.trim();
    if (!name) throw new Error("wrangler secret list entry is missing a name.");
    names.push(name);
  }
  return names;
}

export function productionSecretNamesFromCommand(result: SecretListCommandResult): string[] {
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error("wrangler secret list timed out. Refusing to build the preview.");
  }
  if (result.error) {
    throw new Error(`wrangler secret list failed: ${result.error.message ?? "unknown error"}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim().slice(0, 500);
    throw new Error(
      `wrangler secret list failed (${result.status ?? "no status"}). Refusing to build the preview.${detail ? ` ${detail}` : ""}`,
    );
  }
  return parseWranglerSecretList(result.stdout);
}

export function shadowedProductionSecrets(
  secretNames: readonly string[],
  varNames: readonly string[],
): string[] {
  const secrets = new Set(secretNames);
  return varNames.filter((name) => secrets.has(name));
}

/**
 * Drop every production secret name from Wrangler vars, and refuse the preview
 * when a var the upload sets on purpose uses one of those names.
 */
export function enforcePreviewSecretBoundary(
  config: PreviewWranglerConfig,
  secretNames: readonly string[],
): void {
  const uploadShadow = shadowedProductionSecrets(secretNames, PREVIEW_UPLOAD_VAR_NAMES);
  if (uploadShadow.length > 0) {
    throw new Error(
      `Refusing preview upload: preview vars shadow production secrets (${uploadShadow.join(", ")}).`,
    );
  }
  if (config.vars) {
    for (const name of secretNames) delete config.vars[name];
  }
  const remainingShadow = shadowedProductionSecrets(secretNames, Object.keys(config.vars ?? {}));
  if (remainingShadow.length > 0) {
    throw new Error(
      `Refusing preview upload: Wrangler vars shadow production secrets (${remainingShadow.join(", ")}).`,
    );
  }
}
