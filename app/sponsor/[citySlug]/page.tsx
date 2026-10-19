import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, TopBar, buttonClass } from "@/components/hf/kit";
import { SponsorCard, sponsorDate } from "@/components/hf/sponsor-card";
import { getViewerId } from "@/lib/auth-session";
import { citySlugParam } from "@/lib/core/params";
import { SPONSOR_PRICE_USD } from "@/lib/core/sponsorship";
import { getCity } from "@/lib/places";
import { cityName } from "@/lib/seo";
import { loginHref } from "@/lib/signed-out";
import { citySponsorship } from "@/lib/sponsorships";
import { SponsorForm } from "./sponsor-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ citySlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = citySlugParam((await params).citySlug);
  const city = slug ? await getCity(slug).catch(() => null) : null;
  if (!city) return { title: "City not found", robots: { index: false } };
  const name = cityName(city.city_slug);
  return {
    title: `Sponsor ${name}`,
    description: `Be the one sponsor of halal food in ${name} on halalfood.world, $${SPONSOR_PRICE_USD} a month.`,
    alternates: { canonical: `/sponsor/${city.city_slug}` },
  };
}

export default async function SponsorCityPage({ params }: Props) {
  const slug = citySlugParam((await params).citySlug);
  if (!slug) notFound();
  const city = await getCity(slug);
  if (!city) notFound();
  const name = cityName(city.city_slug);
  const viewerId = await getViewerId();
  const { availability, sponsor } = await citySponsorship(city.city_slug, viewerId);
  return (
    <AppShell active="explore">
      <Page size="form">
        <TopBar back="/sponsor" />
        <div className="grid gap-6 pb-8">
          <PageTitle sub={`${city.place_count} ${city.place_count === 1 ? "place" : "places"} · $${SPONSOR_PRICE_USD} a month · one sponsor at a time`}>
            Sponsor {name}
          </PageTitle>
          {availability.open ? (
            viewerId ? (
              <SponsorForm citySlug={city.city_slug} cityLabel={name} price={SPONSOR_PRICE_USD} />
            ) : (
              <div className="grid gap-4">
                <SponsorCard preview cityLabel={name} sponsor={{ id: "preview", citySlug: city.city_slug, name: "Your business", tagline: "One line about what you do", linkUrl: "https://example.com" }} />
                <p className="text-[15px] font-semibold text-subtle-foreground">Sign in to write your card and pay through Whop.</p>
                <a href={loginHref(`/sponsor/${city.city_slug}`)} className={buttonClass("primary", "lg")}>
                  Sign in to sponsor {name}
                </a>
              </div>
            )
          ) : availability.reason === "sponsored" ? (
            <div className="grid gap-4">
              {sponsor && <SponsorCard preview cityLabel={name} sponsor={sponsor} />}
              <p className="text-[15px] font-semibold text-subtle-foreground">
                {name} has a sponsor until {sponsorDate(availability.until)}
                {availability.renews ? ", and it renews monthly" : ""}. Email{" "}
                <a href="mailto:support@halalfood.world?subject=Sponsor%20waitlist" className="font-extrabold text-foreground underline underline-offset-2">
                  support@halalfood.world
                </a>{" "}
                to hear when it opens up.
              </p>
            </div>
          ) : (
            <p className="text-[15px] font-semibold text-subtle-foreground">
              Someone is checking out for {name} right now. If they don&apos;t finish, it opens again within the hour.
            </p>
          )}
          <p className="text-sm font-semibold text-muted-foreground">
            Sponsors never change a place&apos;s halal status, its checks or where it ranks. Moderators can take down a card that
            misleads people.
          </p>
        </div>
      </Page>
    </AppShell>
  );
}
