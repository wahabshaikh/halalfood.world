import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, TopBar, buttonClass } from "@/components/hf/kit";
import { OWNER_CLAIM_PRICE_USD } from "@/lib/core/owner-claim";
import { placeIdParam } from "@/lib/core/params";
import { getViewerId } from "@/lib/auth-session";
import { claimViewSeries, ownerClaimForViewer, type OwnerClaimRecord } from "@/lib/owner-claims";
import { getPlaceById } from "@/lib/places";
import { loginHref } from "@/lib/signed-out";
import { ownerClaimConfig } from "@/lib/whop";
import { ClaimForm } from "./claim-form";
import { ManagePanel } from "./manage-panel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ placeId: string }>; searchParams: Promise<{ paid?: string }> };

function statusLine(claim: OwnerClaimRecord): string {
  if (claim.status === "pending") return "Waiting for payment";
  if (claim.status === "removed") return "Taken down by a moderator";
  if (!claim.paidLive) return "The paid month has ended";
  if (claim.public) return "Live on the place page";
  if (claim.review === "rejected") return "A moderator declined the public label. You can still edit. Email support@halalfood.world if you want it looked at again.";
  return "Paid. A moderator still has to approve the public label and the Sponsored block. You can prepare hours, the menu and a certificate now.";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = placeIdParam((await params).placeId);
  const place = id ? await getPlaceById(id).catch(() => null) : null;
  if (!place) return { title: "Claim a restaurant", robots: { index: false } };
  return {
    title: `Claim ${place.name}`,
    description: `Claim ${place.name} on halalfood.world. $${OWNER_CLAIM_PRICE_USD} a month. Halal facts stay with the community.`,
    alternates: { canonical: `/claim/${place.id}` },
    robots: { index: false, follow: true },
  };
}

export default async function ClaimPlacePage({ params, searchParams }: Props) {
  const id = placeIdParam((await params).placeId);
  if (!id) notFound();
  const place = await getPlaceById(id);
  if (!place) notFound();
  const viewerId = await getViewerId();
  const paid = (await searchParams).paid === "1";
  const [config, claim] = await Promise.all([
    ownerClaimConfig(),
    viewerId ? ownerClaimForViewer(place.id, viewerId).catch(() => null) : Promise.resolve(null),
  ]);
  const views = claim ? await claimViewSeries(claim.id, viewerId ?? "", undefined, Date.now()).catch(() => null) : null;
  const series = views && views.ok ? views.value : [];

  return (
    <AppShell active="explore">
      <Page size="content">
        <TopBar back={`/place/${place.id}`} />
        <div className="grid gap-8 pb-10">
          <PageTitle sub={`${place.street_address} · $${OWNER_CLAIM_PRICE_USD} a month`}>Claim {place.name}</PageTitle>
          {paid && claim?.status === "pending" && (
            <p className="rounded-2xl border border-border bg-secondary px-4 py-3 text-sm font-semibold">
              If you paid, this page updates once Whop confirms it. Refresh in a moment.
            </p>
          )}
          {claim ? (
            <ManagePanel
              claimId={claim.id}
              canEdit={claim.paidLive}
              statusLine={statusLine(claim)}
              initialHours={claim.hours}
              initialNote={claim.hoursNote ?? ""}
              initialMenu={claim.menu.map((item) => ({
                name: item.name,
                section: item.section ?? "",
                description: item.description ?? "",
                price: item.price === null ? "" : String(item.price),
              }))}
              views={series}
            />
          ) : viewerId ? (
            <ClaimForm placeId={place.id} price={OWNER_CLAIM_PRICE_USD} offered={Boolean(config)} />
          ) : (
            <a href={loginHref(`/claim/${place.id}`)} className={buttonClass("primary", "lg")}>
              Sign in to claim this restaurant
            </a>
          )}
          <p className="text-sm font-semibold leading-relaxed text-muted-foreground">
            The public label and the Sponsored block on the city page wait for a moderator. Hours, the menu and photos stay off the public page until then. A certificate is reviewed separately and never becomes Halal certified just because you paid.{" "}
            <a href="/claim" className="underline underline-offset-2">
              What the plan includes
            </a>
          </p>
        </div>
      </Page>
    </AppShell>
  );
}
