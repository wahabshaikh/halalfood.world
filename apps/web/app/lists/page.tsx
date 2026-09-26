import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import ListsView from "./lists-view";

export const metadata: Metadata = {
  title: "Your lists",
  description: "Ranked and unranked collections of halal places.",
  alternates: { canonical: "/lists" },
  robots: { index: false, follow: true },
};

export default function ListsPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Lists", path: "/lists" },
          ]}
        />
        <PageIntro
          eyebrow={<>YOUR CURATION</>}
          title={<>Lists</>}
          lead={
            <>
              Collections by dish, city, trip, budget or occasion. A published
            ranked list is presented as one person&rsquo;s ranking — never as a
            platform verdict.
            </>
          }
        />
        <ListsView />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
