import * as Sentry from "@sentry/cloudflare";
import vinextHandler from "vinext/server/fetch-handler";
import { workerSentryOptions } from "@/lib/sentry-options";
import { canonicalRedirect } from "@/lib/canonical-host";
import { withPublicCache } from "@/lib/public-cache";
import { runCertifierChecks } from "@/lib/certifiers/check";

type SentryBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

type ScheduledController = { cron: string; scheduledTime: number };

const handler = {
  async fetch(request: Request, env: SentryBindings, ctx: WorkerContext) {
    const redirect = canonicalRedirect(request);
    if (redirect) return redirect;
    return withPublicCache(request, () => vinextHandler.fetch(request, env, ctx));
  },

  /**
   * Cron: re-read the official halal certifier lists (lib/certifiers/check.ts). No trigger is configured
   * in wrangler.jsonc yet; docs/deployment.md has the snippet that turns it on.
   */
  async scheduled(controller: ScheduledController, _env: SentryBindings, ctx: WorkerContext) {
    ctx.waitUntil(
      runCertifierChecks().then((results) => {
        console.log(JSON.stringify({ event: "certifier-check", cron: controller.cron, results }));
        const failed = results.filter((result) => !result.ok || result.needsLook);
        if (failed.length) Sentry.captureMessage(`Certifier check needs a look: ${failed.map((result) => `${result.sourceId}: ${result.error}`).join("; ")}`, "warning");
      }),
    );
  },
};

export default Sentry.withSentry((env: SentryBindings) => workerSentryOptions(env), handler);
