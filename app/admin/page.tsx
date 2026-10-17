import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { EmptyState, Page, TopBar } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { listAllEvents } from "@/lib/events";
import { listOpenReports } from "@/lib/moderation";
import { listPendingEvidence } from "@/lib/place-evidence";
import { isModerator } from "@/lib/moderators";
import { cityName } from "@/lib/place-view";
import { listCities } from "@/lib/places";
import { REASON_LABEL } from "@/lib/core/moderation";
import { loginHref } from "@/lib/signed-out";
import { CHANGE_LABEL, changeSentence } from "@/lib/certifiers/display";
import { importingCountryForAuthority } from "@/lib/certifiers/importing";
import { listPendingChanges, listSources } from "@/lib/certifiers/repository";
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
  const [reports, evidence, events, cities, certChanges, certSources] = await Promise.all([
    listOpenReports(),
    listPendingEvidence(),
    listAllEvents(),
    listCities({ limit: 2000 }),
    listPendingChanges(),
    listSources(),
  ]);
  const shortName = (id: string) => importingCountryForAuthority(id)?.authorityShort ?? id;
  return (
    <AppShell active="you">
      <Page>
        <TopBar back="/me" title="Moderation" />
        <AdminConsole
          reports={reports.map((report) => ({ ...report, reasonLabel: REASON_LABEL[report.reason] ?? report.reason }))}
          evidence={evidence}
          events={events}
          cities={cities.map((city) => ({ slug: city.city_slug, name: cityName(city.city_slug) }))}
          certChanges={certChanges.map((change) => ({
            id: change.id,
            kindLabel: CHANGE_LABEL[change.kind],
            certifierName: change.certifierName,
            certifierSlug: change.certifierSlug,
            authority: shortName(change.authorityId),
            sentence: changeSentence(change.kind, change.before, change.after, shortName(change.authorityId)),
            detectedAt: change.detectedAt,
            sourceUrl: change.sourceUrl,
          }))}
          certSources={certSources.map((source) => ({
            id: source.id,
            authority: shortName(source.authorityId),
            url: source.url,
            lastOkAt: source.lastOkAt,
            lastCheckedAt: source.lastCheckedAt,
            needsLook: source.needsLook,
            lastError: source.lastError,
          }))}
        />
      </Page>
    </AppShell>
  );
}
