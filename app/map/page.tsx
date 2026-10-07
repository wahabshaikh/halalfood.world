import type { Metadata } from "next";
import { citySlugParam, placeIdParam } from "@/lib/core/params";
import { parseFilters } from "@/lib/core/halal";
import { DEFAULT_MAP_VIEW } from "@/lib/core/map-viewport";
import { AppShell } from "@/components/hf/app-shell";
import { getViewerId } from "@/lib/auth-session";
import { getPlaceById } from "@/lib/places";
import { resolveCity } from "@/components/hf/explore-screen";
import MapView from "./map-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Map",
  description: "Halal places on the map, coloured by how many people have checked them.",
  alternates: { canonical: "/map" },
};

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const text = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);
  const viewerId = await getViewerId();
  const placeId = placeIdParam(text("place"));
  const place = placeId ? await getPlaceById(placeId).catch(() => null) : null;
  const { city } = await resolveCity(citySlugParam(text("city"))).catch(() => ({ city: null }));
  const view =
    place?.lat != null && place.lng != null
      ? { center: [place.lng, place.lat] as [number, number], zoom: 15 }
      : city?.center_lat != null && city.center_lng != null
        ? { center: [city.center_lng, city.center_lat] as [number, number], zoom: 12 }
        : DEFAULT_MAP_VIEW;
  return (
    <AppShell active="explore" footer={false} width="full">
      <MapView
        initialView={view}
        citySlug={city?.city_slug ?? null}
        initialFilters={parseFilters(text("filters"))}
        initialFriends={Boolean(viewerId) && text("friends") === "1"}
        signedIn={Boolean(viewerId)}
        selectedId={place?.id ?? null}
      />
    </AppShell>
  );
}
