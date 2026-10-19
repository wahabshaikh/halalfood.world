import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { buttonClass, Page, PageTitle, TopBar } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { newsletterStatusForUser } from "@/lib/newsletter";
import { loginHref } from "@/lib/signed-out";
import { newsletterConfig } from "@/lib/whop";
import { SubscribeButton } from "./subscribe-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Newsletter",
  description: "City picks, new halal food places and sponsor slots from halalfood.world.",
  alternates: { canonical: "/newsletter" },
};

export default async function NewsletterPage() {
  const viewerId = await getViewerId();
  const [config, status] = await Promise.all([
    newsletterConfig(),
    viewerId ? newsletterStatusForUser(viewerId) : Promise.resolve(null),
  ]);
  return (
    <AppShell active="explore">
      <Page size="content">
        <TopBar back="/" />
        <div className="grid gap-8 pb-8">
          <PageTitle sub="City picks, new places and sponsor slots from the community halal food guide.">Newsletter</PageTitle>
          <ul className="grid gap-2.5">
            {["City picks to help you choose where to eat.", "New places added by the community.", "Sponsor slots for businesses supporting the guide."].map((point) => (
              <li key={point} className="flex gap-2.5 text-[15px] font-semibold text-foreground">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />{point}
              </li>
            ))}
          </ul>
          {status?.subscribed ? (
            <div className="grid gap-3">
              <p className="text-lg font-extrabold">You&apos;re subscribed</p>
              {status.manageUrl && <a href={status.manageUrl} className={buttonClass("primary", "lg")}>Manage on Whop</a>}
            </div>
          ) : !config ? (
            <button type="button" disabled className={buttonClass("primary", "lg")}>Not available yet</button>
          ) : viewerId ? <SubscribeButton /> : (
            <a href={loginHref("/newsletter")} className={buttonClass("primary", "lg")}>Sign in to subscribe</a>
          )}
          <p className="text-sm font-semibold text-muted-foreground">Subscriptions and billing are managed by Whop. Sponsors never affect a place&apos;s halal status, its checks or where it ranks.</p>
        </div>
      </Page>
    </AppShell>
  );
}
