import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import SettingsView from "./settings-view";

export const metadata: Metadata = {
  title: "Settings and privacy",
  description: "Your profile photo, private account, follow requests and blocked people.",
  alternates: { canonical: "/settings" },
  robots: { index: false, follow: true },
};

export default function SettingsPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Settings and privacy", path: "/settings" },
          ]}
        />
        <PageIntro
          eyebrow="YOU"
          title="Settings and privacy"
          lead="Choose who can follow you and see your visits and lists. None of this changes a place's halal status."
        />
        <SettingsView />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
