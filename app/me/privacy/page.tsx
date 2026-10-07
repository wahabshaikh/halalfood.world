import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { Page, TopBar } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { listBlocked, listRequests } from "@/lib/people";
import { avatarUrl, ensureProfile } from "@/lib/profiles";
import { loginHref } from "@/lib/signed-out";
import { PrivacyView } from "./privacy-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Privacy & people", robots: { index: false } };

export default async function PrivacyPage() {
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref("/me/privacy"));
  const profile = await ensureProfile(viewerId);
  if (!profile) redirect("/");
  const [requests, blocked] = await Promise.all([listRequests(viewerId), listBlocked(viewerId)]);
  const person = (card: Awaited<ReturnType<typeof listRequests>>[number]) => ({
    handle: card.handle,
    name: card.name,
    avatarUrl: avatarUrl(card.avatarKey, card.handle),
  });
  return (
    <AppShell active="you">
      <Page size="content">
        <TopBar back="/me/settings" title="Privacy & people" />
        <PrivacyView
          initial={{
            isPrivate: profile.isPrivate,
            listsPrivateDefault: profile.listsPrivateDefault,
            showOnLeaderboards: profile.showOnLeaderboards,
          }}
          requests={requests.map(person)}
          blocked={blocked.map(person)}
        />
      </Page>
    </AppShell>
  );
}
