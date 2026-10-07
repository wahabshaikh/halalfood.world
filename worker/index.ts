import * as Sentry from "@sentry/cloudflare";
import vinextHandler from "vinext/server/fetch-handler";
import { workerSentryOptions } from "@/lib/sentry-options";
import { canonicalRedirect } from "@/lib/canonical-host";
import { withPublicCache } from "@/lib/public-cache";

type SentryBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

const handler = {
  async fetch(request: Request, env: SentryBindings, ctx: WorkerContext) {
    const redirect = canonicalRedirect(request);
    if (redirect) return redirect;
    return withPublicCache(request, () => vinextHandler.fetch(request, env, ctx));
  },
};

export default Sentry.withSentry((env: SentryBindings) => workerSentryOptions(env), handler);
