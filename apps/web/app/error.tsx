"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { shouldReportClientPageError } from "../src/lib/sentry-options";
import { AppShell } from "../src/components/app-shell";
import { EmptyState, LinkButton, buttonClass } from "../src/components/kit";

/**
 * Client error boundary for the server-rendered pages. It deliberately shows
 * no error details — upstream failures can carry connection information.
 * Server failures already include a digest and are reported from instrumentation.ts.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!shouldReportClientPageError(error)) return;
    if (!Sentry.getClient()) return;
    Sentry.captureException(error);
  }, [error]);
  return (
    <AppShell>
      <EmptyState
        title="Something went wrong"
        body="This page couldn’t load. Please try again in a moment."
        action={
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonClass("primary")} onClick={reset}>
              Try again
            </button>
            <LinkButton href="/" variant="outline">
              Go home
            </LinkButton>
          </div>
        }
      />
    </AppShell>
  );
}
