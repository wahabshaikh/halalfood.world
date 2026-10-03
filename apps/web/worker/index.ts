import * as Sentry from "@sentry/cloudflare";
import vinextHandler from "vinext/server/fetch-handler";
import { workerSentryOptions } from "../src/lib/sentry-options";

type SentryBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

const handler = {
  fetch(request: Request, env: SentryBindings, ctx: WorkerContext) {
    return vinextHandler.fetch(request, env, ctx);
  },
};

export default Sentry.withSentry((env) => workerSentryOptions(env), handler);
