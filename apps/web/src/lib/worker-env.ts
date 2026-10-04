/**
 * Cloudflare Turnstile dummy keys. They always pass and are not account secrets.
 * Preview requests use them so a preview upload never writes `TURNSTILE_SITE_KEY`
 * (or `TURNSTILE_SECRET_KEY`) as a plain var on the production Worker.
 * Production secret keys reject tokens from the dummy site key.
 */
export const TURNSTILE_PREVIEW_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_PREVIEW_SECRET_KEY = "1x0000000000000000000000000000000AA";

const PREVIEW_TURNSTILE_KEYS: Record<string, string> = {
  TURNSTILE_SITE_KEY: TURNSTILE_PREVIEW_SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_PREVIEW_SECRET_KEY,
};

async function readWorkerBinding(name: string): Promise<string> {
  try {
    const workers = await import("cloudflare:workers");
    const value = workers.env?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // Node tests and scripts have no `cloudflare:workers` module.
  }
  const fromProcess = process.env[name];
  return typeof fromProcess === "string" ? fromProcess.trim() : "";
}

/**
 * Read a Worker variable or secret when the request runs.
 *
 * A static `process.env.SOME_NAME` access is replaced at build time. The
 * production Turnstile site key is a Worker secret, not a Workers Builds or
 * GitHub build variable, so that replacement is an empty string and the login
 * page reports that the bot check is not configured. Bindings are read from
 * the Worker env instead. A dynamic `process.env` lookup remains for Node
 * tests and local scripts, where there is no Workers runtime.
 *
 * When `ENVIRONMENT` is `preview`, Turnstile keys resolve to Cloudflare's
 * always-pass test keys. That lookup does not read or write the production
 * secret names.
 */
export async function readWorkerEnv(name: string): Promise<string> {
  const previewValue = PREVIEW_TURNSTILE_KEYS[name];
  if (previewValue && (await readWorkerBinding("ENVIRONMENT")) === "preview") return previewValue;
  return readWorkerBinding(name);
}
