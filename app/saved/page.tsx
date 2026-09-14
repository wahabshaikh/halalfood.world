import type { Metadata } from "next";
import {
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import SavedPlacesView from "./saved-places-view";

export const metadata: Metadata = {
  title: "Saved places",
  description: "Your saved halal places on halalfood.world.",
  alternates: { canonical: "/saved" },
  robots: { index: false, follow: true },
};

export default function SavedPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "halalfood.world", path: "/" },
            { name: "Saved", path: "/saved" },
          ]}
        />
        <SavedPlacesView />
      </main>
      <SiteFooter />
    </div>
  );
}
