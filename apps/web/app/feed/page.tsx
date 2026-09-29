import type { Metadata } from "next";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import { HomeTabs } from "../../src/components/home-tabs";
import FeedView from "./feed-view";

export const metadata: Metadata = {
  title: "Friends",
  description: "Halal food visits from the people you follow on halalfood.world.",
  alternates: { canonical: "/feed" },
  robots: { index: false, follow: true },
};

export default function FeedPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <HomeTabs active="friends" />
        <FeedView />
      </PageMain>
      <SiteFooter active="explore" />
    </Page>
  );
}
