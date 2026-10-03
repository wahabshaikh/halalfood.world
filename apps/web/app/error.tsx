"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { Button } from "@halalfood/ui/components/button";
import { shouldReportClientPageError } from "../src/lib/sentry-options";
import { EmptyPanel, Page, PageMain } from "../src/components/site-chrome";

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
    <Page>
      <PageMain>
        <EmptyPanel
          title="Something went wrong"
          description="This page couldn’t load. Please try again in a moment."
        >
          <Button size="xl" onClick={reset}>
            Try again
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href="/">Go home</a>
          </Button>
        </EmptyPanel>
      </PageMain>
    </Page>
  );
}
