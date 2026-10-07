import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { Page, TopBar } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { listActivity, listRecs } from "@/lib/inbox";
import { avatarUrl } from "@/lib/profiles";
import { loginHref } from "@/lib/signed-out";
import { InboxView } from "./inbox-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inbox", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function InboxPage({ searchParams }: Props) {
  const tab = (await searchParams).tab === "recs" ? "recs" : "activity";
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref(`/inbox${tab === "recs" ? "?tab=recs" : ""}`));
  const [activity, recs] = await Promise.all([listActivity(viewerId, null), listRecs(viewerId, null)]);
  const url = (actor: { handle: string | null; avatarKey: string | null } | null) => (actor?.handle ? avatarUrl(actor.avatarKey, actor.handle) : null);
  return (
    <AppShell active="friends">
      <Page size="content">
        <TopBar back="/friends" title="Inbox" />
        <InboxView
          tab={tab}
          activity={activity.items.map((item) => ({ ...item, actor: item.actor ? { ...item.actor, avatarUrl: url(item.actor) } : null }))}
          recs={recs.items.map((item) => ({ ...item, sender: { ...item.sender, avatarUrl: url(item.sender) } }))}
        />
      </Page>
    </AppShell>
  );
}
