/**
 * Whether a request is served outside production: local dev, or a Worker Preview on `workers.dev`.
 * Non-production turns on test hooks (the email sink, `/api/test/*`, Turnstile test keys, a development
 * auth secret), so the hostname alone is not enough: the production Worker also answers on `*.workers.dev`
 * Version URLs, and those must keep production behaviour. The deployment's `ENVIRONMENT` var decides
 * (`production` at the top level of wrangler.jsonc, `preview` in its `previews` block), and an unset
 * value counts as production.
 */
export function isNonProductionHost(host: string, environment: string | undefined): boolean {
  const name = host.trim().toLowerCase();
  if (name === "localhost" || name === "127.0.0.1" || name === "::1") return true;
  return environment !== undefined && environment !== "" && environment !== "production" && name.endsWith(".workers.dev");
}

/**
 * Base URL for links a request sends out (emails, auth callbacks). Outside production that is the
 * request's own origin, so a link from a Preview opens that Preview; in production it is the configured
 * public origin.
 */
export function linkBase(requestUrl: string, publicBaseUrl: string | undefined, environment: string | undefined): string {
  const url = new URL(requestUrl);
  if (isNonProductionHost(url.hostname, environment)) return url.origin;
  return (publicBaseUrl || "https://halalfood.world").replace(/\/$/, "");
}
