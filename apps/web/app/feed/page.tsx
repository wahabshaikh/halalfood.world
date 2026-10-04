import type { Metadata } from "next";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import { HomeTabs } from "../../src/components/home-tabs";
import FeedView from "./feed-view";
import { readEatingCityCookie } from "../../src/lib/eating-city";
import { cityName } from "../../src/lib/seo";

export const metadata: Metadata = {
  title: "Friends",
  description: "Halal food visits from the people you follow on halalfood.world.",
  alternates: { canonical: "/feed" },
  robots: { index: false, follow: true },
};

export default async function FeedPage() {
  const eating = await readEatingCityCookie();
  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <HomeTabs active="friends" />
        {eating ? (
          <p className="mb-5 text-sm text-muted-foreground">
            Suggestions follow {cityName(eating)}, the city you chose.{" "}
            <a className="font-bold underline" href={`/city/${eating}`}>
              Places listed there
            </a>
            {" · "}
            <a className="font-bold underline" href={`/map?city=${encodeURIComponent(eating)}`}>
              Map
            </a>
            {" · "}
            <a className="font-bold underline" href={`/events?city=${encodeURIComponent(eating)}`}>
              Events
            </a>
          </p>
        ) : (
          <p className="mb-5 text-sm text-muted-foreground">
            Pick where you are eating and suggestions use that city.{" "}
            <a className="font-bold underline" href="/#where-eating">
              Where are you eating?
            </a>
          </p>
        )}
        <FeedView />
      </PageMain>
      <SiteFooter active="explore" />
    </Page>
  );
}
