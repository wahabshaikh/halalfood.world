/**
 * Shared Sentry options for the Worker and the browser.
 *
 * `@sentry/cloudflare` 11 removed `sendDefaultPii`. The data-collection block
 * below is the replacement that keeps people, cookies, request bodies, and
 * credential headers out of events.
 */
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpBodies: [] as Array<
    "incomingRequest" | "outgoingRequest" | "incomingResponse" | "outgoingResponse"
  >,
  httpHeaders: {
    deny: ["authorization", "cookie", "set-cookie"],
  },
  stackFrameVariables: false,
};

export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

export type SentryOptions = {
  dsn: string;
  tracesSampleRate: number;
  dataCollection: typeof sentryDataCollection;
  environment?: string;
};

export function resolveSentryEnvironment(
  explicit: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const chosen = explicit?.trim() || fallback?.trim();
  return chosen || undefined;
}

export function workerSentryOptions(env: {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
}): SentryOptions {
  const environment = resolveSentryEnvironment(env.ENVIRONMENT, process.env.NODE_ENV);
  return {
    dsn: env.SENTRY_DSN?.trim() ?? "",
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: sentryDataCollection,
    ...(environment ? { environment } : {}),
  };
}

/** Returns undefined when the DSN is missing so the browser SDK stays uninitialized. */
export function browserSentryOptions(input: {
  dsn?: string;
  environment?: string;
}): SentryOptions | undefined {
  const dsn = input.dsn?.trim();
  if (!dsn) return undefined;
  const environment = input.environment?.trim();
  return {
    dsn,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: sentryDataCollection,
    ...(environment ? { environment } : {}),
  };
}

/** Client error boundaries report here. Server failures already carry a digest. */
export function shouldReportClientPageError(error: { digest?: string }): boolean {
  return !error.digest;
}

/**
 * Read one string var from a wrangler jsonc document.
 * Full-line `//` comments are stripped. Values are not interpreted.
 */
export function readWranglerStringVar(source: string, name: string): string {
  const json = source.replace(/^\s*\/\/.*$/gm, "");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || !("vars" in parsed)) return "";
  const vars = parsed.vars;
  if (!vars || typeof vars !== "object" || !(name in vars)) return "";
  const value = (vars as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

/** Browser DSN: build-time public env, then the committed Worker var. */
export function resolveBrowserSentryDsn(
  publicDsn: string | undefined,
  wranglerSource: string,
): string {
  const fromEnv = publicDsn?.trim();
  if (fromEnv) return fromEnv;
  return readWranglerStringVar(wranglerSource, "SENTRY_DSN");
}
