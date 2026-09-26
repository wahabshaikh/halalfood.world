import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import PreferencesForm from "./preferences-form";

export const metadata: Metadata = {
  title: "Your dietary standards",
  description:
    "Set the halal evidence threshold and the factual requirements that apply to your searches.",
  alternates: { canonical: "/preferences" },
  robots: { index: false, follow: true },
};

export default function PreferencesPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Dietary standards", path: "/preferences" },
          ]}
        />
        <PageIntro
          eyebrow={<>YOUR STANDARDS, NOT OURS</>}
          title={<>Dietary standards</>}
          lead={
            <>
              Halalfood does not issue religious rulings. It publishes the
            evidence and lets you set the threshold you are comfortable with.
            These settings decide what counts as suitable <em>for you</em> on
            every place page and in the map filters.
            </>
          }
        />
        <PreferencesForm />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
