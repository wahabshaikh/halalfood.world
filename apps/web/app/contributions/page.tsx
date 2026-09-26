import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import ContributionsView from "./contributions-view";

export const metadata: Metadata = {
  title: "Your contributions",
  description: "The status of every correction, dish, evidence item and report you submitted.",
  alternates: { canonical: "/contributions" },
  robots: { index: false, follow: true },
};

export default function ContributionsPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Contributions", path: "/contributions" },
          ]}
        />
        <PageIntro
          eyebrow={<>WHAT HAPPENED TO YOUR SUBMISSIONS</>}
          title={<>Contributions</>}
          lead={
            <>
              Pending, accepted, needs evidence, rejected or superseded — each
            with the reason. Every decision on a report can be appealed.
            </>
          }
        />
        <ContributionsView />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
