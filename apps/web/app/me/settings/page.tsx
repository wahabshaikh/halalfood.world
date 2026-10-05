import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "../../../src/components/app-shell";
import { Page, TopBar } from "../../../src/components/kit";
import { database } from "../../../src/db";
import { getViewerId } from "../../../src/lib/auth-session";
import { avatarUrl, ensureProfile, profileStats } from "../../../src/lib/profiles";
import { loginHref } from "../../../src/lib/signed-out";
import { SettingsView } from "./settings-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default async function SettingsPage() {
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref("/me/settings"));
  const profile = await ensureProfile(viewerId);
  if (!profile) redirect("/");
  const db = await database();
  const [[user], stats] = await Promise.all([
    db.all<{ email: string }>(sql`SELECT email FROM "user" WHERE id = ${viewerId}`),
    profileStats(viewerId),
  ]);
  return (
    <AppShell active="you">
      <Page size="content">
        <TopBar back="/me" title="Settings" />
        <SettingsView
        seed={viewerId}
        email={user?.email ?? ""}
        pendingRequests={stats.pendingRequests}
        initial={{
          displayName: profile.displayName,
          handle: profile.handle,
          bio: profile.bio ?? "",
          avatarUrl: avatarUrl(profile.avatarKey, profile.handle),
          filters: profile.defaultFilters,
        }}
        />
      </Page>
    </AppShell>
  );
}
