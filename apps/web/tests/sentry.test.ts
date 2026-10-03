import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  browserSentryOptions,
  readWranglerStringVar,
  resolveBrowserSentryDsn,
  resolveSentryEnvironment,
  SENTRY_TRACES_SAMPLE_RATE,
  sentryDataCollection,
  shouldReportClientPageError,
  workerSentryOptions,
} from "../src/lib/sentry-options";

const DSN =
  "https://628e981cc4682959d5a7b79f0b73ecea@o4512156631171073.ingest.us.sentry.io/4512190880284672";

test("worker options disable Sentry when the DSN is blank", () => {
  const options = workerSentryOptions({ SENTRY_DSN: "  ", ENVIRONMENT: "production" });
  assert.equal(options.dsn, "");
  assert.equal(options.environment, "production");
  assert.equal(options.tracesSampleRate, SENTRY_TRACES_SAMPLE_RATE);
  assert.equal(options.dataCollection, sentryDataCollection);
  assert.equal(options.dataCollection.userInfo, false);
  assert.equal(options.dataCollection.cookies, false);
  assert.deepEqual(options.dataCollection.httpBodies, []);
  assert.equal("replaysSessionSampleRate" in options, false);
  assert.equal("profilesSampleRate" in options, false);
});

test("worker options prefer ENVIRONMENT over the Node fallback", () => {
  const options = workerSentryOptions({
    SENTRY_DSN: DSN,
    ENVIRONMENT: " preview ",
  });
  assert.equal(options.dsn, DSN);
  assert.equal(options.environment, "preview");
});

test("resolveSentryEnvironment keeps an explicit value and ignores blanks", () => {
  assert.equal(resolveSentryEnvironment(" staging ", "production"), "staging");
  assert.equal(resolveSentryEnvironment("  ", "development"), "development");
  assert.equal(resolveSentryEnvironment(undefined, "   "), undefined);
});

test("browser options stay uninitialized without a DSN", () => {
  assert.equal(browserSentryOptions({ dsn: "  ", environment: "production" }), undefined);
  const options = browserSentryOptions({ dsn: DSN, environment: " production " });
  assert.equal(options?.dsn, DSN);
  assert.equal(options?.environment, "production");
  assert.equal(options?.tracesSampleRate, 0.1);
});

test("client page errors with a server digest are not reported again", () => {
  assert.equal(shouldReportClientPageError({ digest: "abc" }), false);
  assert.equal(shouldReportClientPageError({ digest: "" }), true);
  assert.equal(shouldReportClientPageError({}), true);
});

test("wrangler jsonc comments do not hide string vars", () => {
  const source = `{
    // comment with https://example.com
    "vars": {
      "SENTRY_DSN": "${DSN}",
      "OTHER": 1
    }
  }`;
  assert.equal(readWranglerStringVar(source, "SENTRY_DSN"), DSN);
  assert.equal(readWranglerStringVar(source, "OTHER"), "");
  assert.equal(readWranglerStringVar(source, "MISSING"), "");
});

test("browser DSN prefers NEXT_PUBLIC_SENTRY_DSN, then the wrangler var", () => {
  const source = `{ "vars": { "SENTRY_DSN": "${DSN}" } }`;
  assert.equal(resolveBrowserSentryDsn(" https://public.example/1 ", source), "https://public.example/1");
  assert.equal(resolveBrowserSentryDsn("  ", source), DSN);
  assert.equal(resolveBrowserSentryDsn(undefined, `{ "name": "app" }`), "");
});

test("committed wrangler config publishes the Sentry DSN as a var", () => {
  const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.equal(readWranglerStringVar(source, "SENTRY_DSN"), DSN);
});
