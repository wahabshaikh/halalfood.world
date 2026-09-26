import type { Metadata } from "next";
import { SiteHeader, TabBar } from "../../src/components/site-chrome";
import MapView from "./map-view";
import { loadLocalContext } from "../../src/lib/local-context-repository";
import { initialMapView } from "../../src/lib/local-context";

export const metadata: Metadata = {
  title: "Map of halal places",
  description:
    "Explore halal restaurants on the map, near you or anywhere you travel, with halal checks from people who ate there.",
  alternates: { canonical: "/map" },
};

export default async function MapPage() {
  // A failed lookup just opens the default view; the map never waits on it.
  const initialView = await loadLocalContext()
    .then(initialMapView)
    .catch(() => null);
  return (
    <div className="page">
      <SiteHeader />
      <main>
        <MapView initialView={initialView} />
      </main>
      <TabBar active="map" />
    </div>
  );
}
