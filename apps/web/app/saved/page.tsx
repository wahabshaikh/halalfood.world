import type { Metadata } from "next";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import SavedPlacesView from "./saved-places-view";

export const metadata: Metadata = {
  title: "Saved places",
  description: "Your saved places on halalfood.world.",
  alternates: { canonical: "/saved" },
  robots: { index: false, follow: true },
};

export default function SavedPage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <SavedPlacesView />
      </PageMain>
      <SiteFooter active="saved" />
    </Page>
  );
}
