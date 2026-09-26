import type { Metadata } from "next";
import { SiteHeader, TabBar } from "../../src/components/site-chrome";
import MapView from "./map-view";

export const metadata: Metadata = {
  title: "Map of halal places",
  description:
    "Explore halal restaurants on the map, near you or anywhere you travel, with halal checks from people who ate there.",
  alternates: { canonical: "/map" },
};

export default function MapPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main>
        <MapView />
      </main>
      <TabBar active="map" />
    </div>
  );
}
