import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
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
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Moderation", path: "/admin" },
          ]}
        />
        <PageIntro
          eyebrow={<>PROTECT THE DATABASE</>}
          title={<>Moderation console</>}
          lead={
            <>
              Operational tooling is part of the trust product, not back-office
            polish. Every decision here is recorded in the audit log with its
            actor, reason and source.
            </>
          }
        />
        <AdminConsole />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
