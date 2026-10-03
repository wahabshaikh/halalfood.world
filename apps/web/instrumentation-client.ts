import * as Sentry from "@sentry/react";
import { browserSentryOptions, resolveSentryEnvironment } from "./src/lib/sentry-options";

declare const __HALALFOOD_SENTRY_DSN__: string;

function runtimeEnvironment(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.dataset.sentryEnvironment;
}

if (typeof window !== "undefined") {
  const options = browserSentryOptions({
    dsn: __HALALFOOD_SENTRY_DSN__,
    environment: resolveSentryEnvironment(runtimeEnvironment(), process.env.NODE_ENV),
  });
  if (options) Sentry.init(options);
}
