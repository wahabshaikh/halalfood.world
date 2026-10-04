/**
 * Read a Worker variable or secret when the request runs.
 *
 * A static `process.env.SOME_NAME` access is replaced at build time. The
 * production Turnstile site key is a Worker secret, not a Workers Builds or
 * GitHub build variable, so that replacement is an empty string and the login
 * page reports that the bot check is not configured. Bindings are read from
 * the Worker env instead. A dynamic `process.env` lookup remains for Node
 * tests and local scripts, where there is no Workers runtime.
 */
export async function readWorkerEnv(name: string): Promise<string> {
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
