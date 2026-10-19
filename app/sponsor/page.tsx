import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, SectionTitle, TopBar } from "@/components/hf/kit";
import { sponsorDate } from "@/components/hf/sponsor-card";
import { getViewerId } from "@/lib/auth-session";
import { SPONSOR_PRICE_USD } from "@/lib/core/sponsorship";
import { listCities } from "@/lib/places";
import { cityName } from "@/lib/seo";
import { liveSponsorsByCity, mySponsorships, type MySponsorship } from "@/lib/sponsorships";
import { SponsorCityList } from "./sponsor-city-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sponsor a city",
  description: `Sponsor halal food in your city on halalfood.world: one sponsor per city, $${SPONSOR_PRICE_USD} a month.`,
  alternates: { canonical: "/sponsor" },
};

const POINTS = [
  "Your name, one line and a link on the city's Explore page, labelled Sponsor.",
  "One sponsor per city at a time, so you're the only one there.",
  `$${SPONSOR_PRICE_USD} a month through Whop. Cancel any time; your card stays up until the month you paid for ends.`,
  "Sponsors never change a place's halal status, its checks or where it ranks. That's what keeps the guide worth sponsoring.",
];

function statusLine(item: MySponsorship, now: number): string {
  if (item.status === "pending") return "Waiting for payment";
  if (item.status === "refunded") return "Refunded";
  if (item.status === "removed") return "Taken down by a moderator";
  if (item.startsAt !== null && item.startsAt > now) return `Starts ${sponsorDate(item.startsAt)}`;
  if (item.activeUntil !== null && item.activeUntil <= now) return `Ended ${sponsorDate(item.activeUntil)}`;
  return item.activeUntil !== null ? `${item.renews ? "Renews" : "Ends"} ${sponsorDate(item.activeUntil)}` : "Live";
}

export default async function SponsorPage() {
  const viewerId = await getViewerId();
  const now = Date.now();
  const [cities, sponsors, mine] = await Promise.all([
    listCities({ limit: 2000 }),
    liveSponsorsByCity().catch(() => new Map()),
    viewerId ? mySponsorships(viewerId).catch(() => []) : Promise.resolve([]),
  ]);
  return (
    <AppShell active="explore">
      <Page size="content">
        <TopBar back="/" />
        <div className="grid gap-8 pb-8">
          <PageTitle sub="Put your business in front of people choosing where to eat halal, one city at a time.">Sponsor a city</PageTitle>
          <ul className="grid gap-2.5">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-2.5 text-[15px] font-semibold text-foreground">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {point}
              </li>
            ))}
          </ul>
          {mine.length > 0 && (
            <section aria-labelledby="mine-title" className="grid gap-2.5">
              <SectionTitle id="mine-title">Your sponsorships</SectionTitle>
              <ul className="grid divide-y divide-border/70">
                {mine.map((item) => (
                  <li key={item.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <a href={`/city/${item.citySlug}`} className="min-w-0">
                      <span className="block truncate text-[15px] font-extrabold">{cityName(item.citySlug)}</span>
                      <span className="block truncate text-sm font-semibold text-muted-foreground">{item.name}</span>
                    </a>
                    <span className="shrink-0 text-sm font-bold text-subtle-foreground">{statusLine(item, now)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="cities-title" className="grid gap-2.5">
            <SectionTitle id="cities-title">Choose a city</SectionTitle>
            <SponsorCityList
              cities={cities.map((city) => {
                const sponsor = sponsors.get(city.city_slug);
                return {
                  slug: city.city_slug,
                  name: cityName(city.city_slug),
                  country: city.address_country,
                  count: city.place_count,
                  sponsoredUntil: sponsor ? sponsorDate(sponsor.activeUntil) : null,
                };
              })}
            />
          </section>
        </div>
      </Page>
    </AppShell>
  );
}
