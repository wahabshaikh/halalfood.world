import * as Sentry from "@sentry/cloudflare";

type RequestInfo = {
  path: string;
  method: string;
};

type ErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

/**
 * Vinext calls this for failures it handles inside the request (render, route
 * handlers). The Worker wrapper reports anything that escapes `fetch`.
 * Request headers are intentionally omitted.
 */
export function onRequestError(
  error: unknown,
  request: RequestInfo,
  context: ErrorContext,
): void {
  const routePath = context.routePath?.trim();
  const routeType = context.routeType?.trim();
  Sentry.captureException(error, {
    tags: {
      method: request.method,
      path: request.path,
      ...(routePath ? { routePath } : {}),
      ...(routeType ? { routeType } : {}),
    },
  });
}
