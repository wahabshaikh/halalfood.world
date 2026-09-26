import type { Metadata } from "next";
import { Button } from "@halalfood/ui/components/button";
import {
  EmptyPanel,
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../src/components/site-chrome";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <EmptyPanel
          art="map"
          title="We couldn’t find that page"
          description="The place or city may have moved, or the link might have a typo."
        >
          <Button asChild size="xl">
            <a href="/">Start exploring</a>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href="/cities">Browse cities</a>
          </Button>
        </EmptyPanel>
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
