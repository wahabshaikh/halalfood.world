import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { BadgeRow, Page, PageTitle, SectionTitle, TopBar } from "@/components/hf/kit";
import { BADGES, BAND_LABEL, BANDS, type Badge, type Band } from "@/lib/core/trust";

export const metadata: Metadata = {
  title: "How trust works",
  description: "What the badges and trust words on halalfood.world places mean, and what earns them.",
  alternates: { canonical: "/how-trust-works" },
};

/** Plain words for the rules in lib/core/trust.ts (placeBadges, trustBand). */
const BADGE_MEANS: Record<Badge, string> = {
  halal_certified: "A moderator approved an unexpired halal certificate for this place. A web page saying it’s certified isn’t enough.",
  community_verified: "At least one member who ate here vouched for it, and their vouch counts.",
  creator_verified: "A food creator showed this place in a video.",
  muslim_owned: "The owner proved it with a claim a moderator approved. Answers from the community alone don’t earn it.",
  serves_alcohol: "An approved menu shows alcohol, or the people who checked agree it’s served.",
  serves_pork: "An approved menu shows pork, or the people who checked agree it’s served. The place also goes to review.",
};

const BAND_MEANS: Record<Band, string> = {
  unverified: "Little or no proof yet. That doesn’t mean it isn’t halal.",
  some_proof: "Some proof, such as a creator video or a few vouches.",
  trusted: "Good proof, such as a certificate or many vouches that agree.",
  highly_trusted: "Several kinds of proof that agree.",
};

export default function HowTrustWorksPage() {
  return (
    <AppShell active="explore">
      <Page size="content">
        <TopBar back="/" />
        <div className="grid gap-8 pb-8">
          <PageTitle sub="Badges and trust words say how much real-world proof stands behind a place. They never change its halal status, which comes from the four questions people answer.">
            How trust works
          </PageTitle>
          <section aria-labelledby="badges" className="grid gap-3">
            <SectionTitle id="badges">Badges</SectionTitle>
            <dl className="grid gap-4">
              {BADGES.map((badge) => (
                <div key={badge} className="grid gap-1.5">
                  <dt>
                    <BadgeRow badges={[badge]} />
                  </dt>
                  <dd className="text-[15px] font-semibold text-subtle-foreground">{BADGE_MEANS[badge]}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm font-semibold text-muted-foreground">
              A place imported from a directory and not yet seen by anyone shows no badges until it earns proof.
            </p>
          </section>
          <section aria-labelledby="bands" className="grid gap-3">
            <SectionTitle id="bands">Trust</SectionTitle>
            <p className="text-[15px] font-semibold text-subtle-foreground">
              Each place gets a trust word from its certificates, creator videos, vouches (members with a longer record count more),
              settled answers and menus. Open reports, disputed answers and bursts of brand-new accounts lower it, and pork on the menu
              keeps it at Unverified.
            </p>
            <dl className="grid gap-3">
              {BANDS.map((band) => (
                <div key={band} className="grid gap-0.5">
                  <dt className="text-[15px] font-black">{BAND_LABEL[band]}</dt>
                  <dd className="text-[15px] font-semibold text-subtle-foreground">{BAND_MEANS[band]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </Page>
    </AppShell>
  );
}
