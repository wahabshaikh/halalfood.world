import type { Metadata } from "next";
import {
  Breadcrumbs,
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
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Lists", path: "/lists" },
          ]}
        />
        <div className="page-intro">
          <p className="eyebrow">YOUR CURATION</p>
          <h1>Lists</h1>
          <p className="lead">
            Collections by dish, city, trip, budget or occasion. A published
            ranked list is presented as one person&rsquo;s ranking — never as a
            platform verdict.
          </p>
        </div>
        <ListsView />
      </main>
      <SiteFooter />
    </div>
  );
}
