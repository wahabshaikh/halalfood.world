"use client";

import { Button } from "@halalfood/ui/components/button";
import { EmptyPanel, Page, PageMain } from "../src/components/site-chrome";

/**
 * Client error boundary for the server-rendered pages. It deliberately shows
 * no error details — upstream failures can carry connection information.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
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
