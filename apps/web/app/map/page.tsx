import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Page,
  SiteHeader,
  TabBar,
} from "../../src/components/site-chrome";
import MapView from "./map-view";
import { loadLocalContext } from "../../src/lib/local-context-repository";
import { initialMapView } from "../../src/lib/local-context";
import { readEatingCityCookie } from "../../src/lib/eating-city";

export const metadata: Metadata = {
  title: "Map of halal places",
  description:
    "Explore halal restaurants on the map, near you or anywhere you travel, with halal checks from people who ate there.",
  alternates: { canonical: "/map" },
};

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const explicit = ["city", "place", "lat", "lng"].some(
    (key) => typeof params[key] === "string" && params[key] !== "",
  );
  const eating = explicit ? null : await readEatingCityCookie();
  if (eating) redirect(`/map?city=${encodeURIComponent(eating)}`);
  // A failed lookup just opens the default view; the map never waits on it.
  const initialView = await loadLocalContext()
    .then(initialMapView)
    .catch(() => null);
  return (
    <Page>
      <SiteHeader />
      <main>
        <MapView initialView={initialView} />
      </main>
      <TabBar active="map" />
    </Page>
  );
}
