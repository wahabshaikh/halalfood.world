import type { Metadata } from "next";
import {
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import AdminConsole from "./admin-console";

export const metadata: Metadata = {
  title: "Moderation console",
  description: "Evidence queue, edits, duplicates, reports and the audit log.",
  alternates: { canonical: "/admin" },
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Moderation", path: "/admin" },
          ]}
        />
        <div className="page-intro">
          <p className="eyebrow">PROTECT THE DATABASE</p>
          <h1>Moderation console</h1>
          <p className="lead">
            Operational tooling is part of the trust product, not back-office
            polish. Every decision here is recorded in the audit log with its
            actor, reason and source.
          </p>
        </div>
        <AdminConsole />
      </main>
      <SiteFooter />
    </div>
  );
}
