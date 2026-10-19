import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { Page, TopBar } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { listMemberKeys } from "@/lib/member-keys";
import { loginHref } from "@/lib/signed-out";
import { KeysView } from "./keys-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "API keys", robots: { index: false } };

export default async function KeysPage() {
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref("/me/keys"));
  return (
    <AppShell active="you">
      <Page size="content">
        <TopBar back="/me/settings" title="API keys" />
        <KeysView initial={await listMemberKeys(viewerId)} />
      </Page>
    </AppShell>
  );
}
