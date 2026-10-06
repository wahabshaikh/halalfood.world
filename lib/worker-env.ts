import { isNonProductionHost } from "./environment";
import { requestHostname } from "./request-host";

/**
 * Cloudflare Turnstile dummy keys. They always pass and are not account secrets.
 * Non-production hosts (localhost and Worker Previews, see `lib/environment.ts`) use them, so sign-in
 * works there without any Turnstile secret. Production secret keys reject tokens from the dummy site
 * key, and `halalfood.world` never receives these keys.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const TEST_TURNSTILE_KEYS: Record<string, string> = {
  TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
};

/** A Worker binding of any type (D1, R2, send_email, …), or undefined outside the Workers runtime. */
export async function readBinding<T>(name: string): Promise<T | undefined> {
  try {
    const workers = await import("cloudflare:workers");
    return (workers.env?.[name] ?? undefined) as T | undefined;
  } catch {
    // Node scripts have no `cloudflare:workers` module.
    return undefined;
  }
}

async function readWorkerBinding(name: string): Promise<string> {
  const value = await readBinding<unknown>(name);
  if (typeof value === "string" && value.trim()) return value.trim();
  const fromProcess = process.env[name];
  return typeof fromProcess === "string" ? fromProcess.trim() : "";
}

/**
 * Read a Worker variable or secret when the request runs.
 *
 * A static `process.env.SOME_NAME` access is replaced at build time. The production Turnstile site key
 * is a Worker secret, not a build variable, so that replacement would be an empty string. Bindings are
 * read from the Worker env instead, with a dynamic `process.env` lookup for tests and scripts.
 *
 * Turnstile keys resolve to Cloudflare's always-pass test keys on non-production hosts only.
 */
export async function readWorkerEnv(name: string, host?: string | null): Promise<string> {
  const testValue = TEST_TURNSTILE_KEYS[name];
  if (testValue && (await isNonProductionRequest(host))) return testValue;
  return readWorkerBinding(name);
}

/** The deployment's `ENVIRONMENT` var: "production" at the top level of wrangler.jsonc, "preview" in Previews. */
export async function deploymentEnvironment(): Promise<string | undefined> {
  return (await readWorkerBinding("ENVIRONMENT")) || undefined;
}

/**
 * True for localhost and for a Worker Preview on `*.workers.dev` (see `isNonProductionHost`). The
 * production Worker's own workers.dev and Version URLs keep production behaviour, because its
 * `ENVIRONMENT` is "production" and a request cannot change it.
 */
export async function isNonProductionRequest(host: string | null | undefined): Promise<boolean> {
  const hostname = requestHostname(host);
  if (!hostname) return false;
  return isNonProductionHost(hostname, await deploymentEnvironment());
}
