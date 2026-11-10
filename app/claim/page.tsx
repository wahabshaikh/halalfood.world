import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, TopBar } from "@/components/hf/kit";
import { OWNER_CLAIM_PRICE_USD } from "@/lib/core/owner-claim";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Claim your restaurant",
  description: `Claim your restaurant on halalfood.world for $${OWNER_CLAIM_PRICE_USD} a month. Hours, menu, photos and a sponsored place on your city page. Halal facts stay with the community.`,
  alternates: { canonical: "/claim" },
};

const POINTS = [
  "A “Claimed by the restaurant” line on your place page, after a moderator checks the claim. It is not Community verified.",
  "Hours, a menu, photos, and a phone, website and short description you keep up to date. They are labelled as coming from the restaurant and stay off the public page until a moderator approves the claim.",
  "Upload a photo of your halal certificate. It stays pending until a moderator approves it. Paying does not approve it.",
  "A place in the Sponsored block on your city page, separate from the list, with a Sponsored label. It does not move you up the list.",
  "A simple count of visits to your place page over the last 30 days.",
];

export default function ClaimPage() {
  return (
    <AppShell active="explore">
      <Page size="content">
        <TopBar back="/" />
        <div className="grid gap-8 pb-10">
          <PageTitle sub="For the person who runs the restaurant. The community still decides the halal facts.">
            Claim your restaurant
          </PageTitle>
          <p className="text-[28px] leading-none font-black tracking-tight tabular-nums">
            ${OWNER_CLAIM_PRICE_USD}
            <span className="ml-1 text-base font-bold text-muted-foreground">a month</span>
          </p>
          <ul className="grid gap-3">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-2.5 text-[15px] font-semibold leading-snug text-foreground">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {point}
              </li>
            ))}
          </ul>
          <section className="grid gap-2 rounded-2xl border border-border bg-card px-4 py-4">
            <h2 className="text-[15px] font-black">What payment does not do</h2>
            <p className="text-sm font-semibold leading-relaxed text-muted-foreground">
              It does not change halal status, settle a fact, or rank the restaurant above others. The Sponsored block is labelled and kept apart from the place list. City sponsorship, at $49 a month for one card on a whole city, is a separate offer.
            </p>
          </section>
          <p className="text-[15px] font-semibold leading-relaxed">
            Open the restaurant on halalfood.world and choose <span className="font-extrabold">Claim this restaurant</span>. Checkout stays off until the plan is configured.
          </p>
          <p className="text-sm font-semibold text-muted-foreground">
            Billing is handled by Whop. Cancel any time; the paid month runs to its end. Questions: support@halalfood.world.
          </p>
        </div>
      </Page>
    </AppShell>
  );
}
