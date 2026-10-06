import * as Sentry from "@sentry/react";
import { browserSentryOptions, resolveSentryEnvironment } from "@/lib/sentry-options";
import { installStaleChunkReload } from "@/lib/stale-chunk-reload";

declare const __HALALFOOD_SENTRY_DSN__: string;
declare const __HALALFOOD_SENTRY_ENVIRONMENT__: string;

function runtimeEnvironment(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.dataset.sentryEnvironment;
}

if (typeof window !== "undefined") {
  installStaleChunkReload(window);
  const options = browserSentryOptions({
    dsn: __HALALFOOD_SENTRY_DSN__,
    environment: resolveSentryEnvironment(
      runtimeEnvironment() || __HALALFOOD_SENTRY_ENVIRONMENT__,
      process.env.NODE_ENV,
    ),
  });
  if (options) Sentry.init(options);
}
