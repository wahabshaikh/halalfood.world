import type { Metadata } from "next";
import {
  Breadcrumbs,
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
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Contributions", path: "/contributions" },
          ]}
        />
        <div className="page-intro">
          <p className="eyebrow">WHAT HAPPENED TO YOUR SUBMISSIONS</p>
          <h1>Contributions</h1>
          <p className="lead">
            Pending, accepted, needs evidence, rejected or superseded — each
            with the reason. Every decision on a report can be appealed.
          </p>
        </div>
        <ContributionsView />
      </main>
      <SiteFooter />
    </div>
  );
}
