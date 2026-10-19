import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { EmptyState, Page, PageTitle, TopBar, buttonClass } from "@/components/hf/kit";
import { SponsorCard, sponsorDate } from "@/components/hf/sponsor-card";
import { getViewerId } from "@/lib/auth-session";
import { cityName } from "@/lib/seo";
import { loginHref } from "@/lib/signed-out";
import { mySponsorships } from "@/lib/sponsorships";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Thanks for sponsoring", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Where Whop sends a buyer back. The webhook, not this page, is what activates the card. */
export default async function SponsorThanksPage({ searchParams }: Props) {
  const raw = (await searchParams).id;
  const id = typeof raw === "string" ? raw : "";
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref(`/sponsor/thanks?id=${encodeURIComponent(id)}`));
  const item = (await mySponsorships(viewerId)).find((row) => row.id === id) ?? null;
  const now = Date.now();
  return (
    <AppShell active="explore">
      <Page size="form">
        <TopBar back="/sponsor" />
        {!item ? (
          <EmptyState title="Sponsorship not found" body="It may belong to another account. Your sponsorships are listed on the sponsor page." />
        ) : (
          <div className="grid gap-5 pb-8">
            {item.status === "active" ? (
              <PageTitle
                sub={
                  item.startsAt !== null && item.startsAt > now
                    ? `Your card goes up on ${sponsorDate(item.startsAt)}.`
                    : `Your card is live${item.activeUntil ? ` and renews ${sponsorDate(item.activeUntil)}` : ""}.`
                }
              >
                Thanks for sponsoring {cityName(item.citySlug)}
              </PageTitle>
            ) : item.status === "pending" ? (
              <PageTitle sub="We're waiting for Whop to confirm your payment. That usually takes a few seconds; refresh this page.">
                Almost there
              </PageTitle>
            ) : (
              <PageTitle sub="This sponsorship isn't active. Email support@halalfood.world if that's unexpected.">Not active</PageTitle>
            )}
            <SponsorCard preview cityLabel={cityName(item.citySlug)} sponsor={item} />
            <div className="grid gap-2.5 md:grid-cols-2">
              {item.status === "pending" && (
                <a href={`/sponsor/thanks?id=${item.id}`} className={buttonClass("primary", "lg")}>
                  Refresh
                </a>
              )}
              <a href={`/city/${item.citySlug}`} className={buttonClass("outline", "lg")}>
                See {cityName(item.citySlug)}
              </a>
            </div>
          </div>
        )}
      </Page>
    </AppShell>
  );
}
