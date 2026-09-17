import type { Metadata } from "next";
import {
  Breadcrumbs,
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
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Food passport", path: "/passport" },
          ]}
        />
        <div className="page-intro">
          <p className="eyebrow">WHERE YOU HAVE EATEN</p>
          <h1>Food passport</h1>
          <p className="lead">
            Coverage, not volume. Verified and self-reported visits are counted
            separately, and the milestones reward exploring widely, going back,
            and keeping halal evidence current.
          </p>
        </div>
        <PassportView />
      </main>
      <SiteFooter />
    </div>
  );
}
