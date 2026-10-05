import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "../../src/components/app-shell";
import { EmptyState, Page, TopBar } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { listAllEvents } from "../../src/lib/events";
import { listOpenReports } from "../../src/lib/moderation";
import { listPendingEvidence } from "../../src/lib/place-evidence";
import { isModerator } from "../../src/lib/moderators";
import { cityName } from "../../src/lib/place-view";
import { listCities } from "../../src/lib/places";
import { REASON_LABEL } from "@halalfood/core/moderation";
import { loginHref } from "../../src/lib/signed-out";
import { AdminConsole } from "./admin-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moderation", robots: { index: false } };

export default async function AdminPage() {
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref("/admin"));
  if (!(await isModerator(viewerId))) {
    return (
      <AppShell active="you">
        <Page size="content">
          <TopBar back="/me" />
          <EmptyState title="Moderators only" body="This page is for the people who review reports and evidence." />
        </Page>
      </AppShell>
    );
  }
  const [reports, evidence, events, cities] = await Promise.all([
    listOpenReports(),
    listPendingEvidence(),
    listAllEvents(),
    listCities({ limit: 2000 }),
  ]);
  return (
    <AppShell active="you">
      <Page>
        <TopBar back="/me" title="Moderation" />
        <AdminConsole
          reports={reports.map((report) => ({ ...report, reasonLabel: REASON_LABEL[report.reason] ?? report.reason }))}
          evidence={evidence}
          events={events}
          cities={cities.map((city) => ({ slug: city.city_slug, name: cityName(city.city_slug) }))}
        />
      </Page>
    </AppShell>
  );
}
