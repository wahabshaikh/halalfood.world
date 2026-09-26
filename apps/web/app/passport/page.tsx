import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import PassportView from "./passport-view";

export const metadata: Metadata = {
  title: "Food passport",
  description: "Your halal food exploration: coverage, milestones and visited places.",
  alternates: { canonical: "/passport" },
  robots: { index: false, follow: true },
};

export default function PassportPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Food passport", path: "/passport" },
          ]}
        />
        <PageIntro
          eyebrow={<>WHERE YOU HAVE EATEN</>}
          title={<>Food passport</>}
          lead={
            <>
              Coverage, not volume. Verified and self-reported visits are counted
            separately, and the milestones reward exploring widely, going back,
            and keeping halal evidence current.
            </>
          }
        />
        <PassportView />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
