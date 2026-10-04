import * as Sentry from "@sentry/cloudflare";
import vinextHandler from "vinext/server/fetch-handler";
import { workerSentryOptions } from "../src/lib/sentry-options";
import { withPublicCache, type ResponseCache } from "../src/lib/public-cache";

type SentryBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

async function documentCache(): Promise<ResponseCache | null> {
  try {
    const storage = (globalThis as { caches?: { open?: (name: string) => Promise<ResponseCache> } })
      .caches;
    return typeof storage?.open === "function"
      ? await storage.open("halalfood-public-documents")
      : null;
  } catch {
    return null;
  }
}

const handler = {
  async fetch(request: Request, env: SentryBindings, ctx: WorkerContext) {
    return withPublicCache(
      request,
      () => vinextHandler.fetch(request, env, ctx),
      await documentCache(),
      (promise) => ctx.waitUntil(promise),
    );
  },
};

export default Sentry.withSentry((env: SentryBindings) => workerSentryOptions(env), handler);
