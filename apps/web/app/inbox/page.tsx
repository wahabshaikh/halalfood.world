import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "../../src/components/app-shell";
import { TopBar } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { listActivity, listRecs } from "../../src/lib/inbox";
import { avatarUrl } from "../../src/lib/profiles";
import { loginHref } from "../../src/lib/signed-out";
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
      <TopBar back="/friends" title="Inbox" />
      <InboxView
        tab={tab}
        activity={activity.items.map((item) => ({ ...item, actor: item.actor ? { ...item.actor, avatarUrl: url(item.actor) } : null }))}
        recs={recs.items.map((item) => ({ ...item, sender: { ...item.sender, avatarUrl: url(item.sender) } }))}
      />
    </AppShell>
  );
}
