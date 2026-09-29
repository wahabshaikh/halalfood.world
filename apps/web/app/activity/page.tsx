import type { Metadata } from "next";
import { Page, PageMain, SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import { HomeTabs } from "../../src/components/home-tabs";
import ActivityView from "./activity-view";

export const metadata: Metadata = {
  title: "Activity",
  description: "Halal status changes at places you saved, and what your friends are up to.",
  alternates: { canonical: "/activity" },
  robots: { index: false, follow: true },
};

export default function ActivityPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <HomeTabs active="activity" />
        <h1 className="mb-4 text-[clamp(24px,3vw,30px)]">Activity</h1>
        <ActivityView />
      </PageMain>
      <SiteFooter active="explore" />
    </Page>
  );
}
