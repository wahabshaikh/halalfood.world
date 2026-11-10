import * as Sentry from "@sentry/cloudflare";
import vinextHandler from "vinext/server/fetch-handler";
import { workerSentryOptions } from "@/lib/sentry-options";
import { canonicalRedirect } from "@/lib/canonical-host";
import { withPublicCache } from "@/lib/public-cache";
import { requestWithContentSecurityPolicy } from "@/lib/csp";
import { withSecurityHeaders } from "@/lib/security-headers";
import { isUnverifiedPlace } from "@/lib/provenance";
import { withPlaceRobotsHeader } from "@/lib/robots-header";

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
    if (redirect) return withSecurityHeaders(redirect, request);
    // Vinext copies this request's CSP nonce onto its scripts. The response uses the same nonce.
    const stamped = requestWithContentSecurityPolicy(request);
    const response = await withPublicCache(stamped, () =>
      withPlaceRobotsHeader(stamped, () => vinextHandler.fetch(stamped, env, ctx), (placeId) => isUnverifiedPlace(placeId)),
    );
    return withSecurityHeaders(response, stamped);
  },
};

export default Sentry.withSentry((env: SentryBindings) => workerSentryOptions(env), handler);
