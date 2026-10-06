import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/hf/app-shell";
import { Page, TopBar } from "@/components/hf/kit";
import { EATING_CITY_COOKIE } from "@/lib/eating-city";
import { listCities } from "@/lib/places";
import { cityName } from "@/lib/place-view";
import { CityPicker } from "./city-picker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a city",
  description: "Every city with places on halalfood.world.",
  alternates: { canonical: "/cities" },
};

export default async function CitiesPage() {
  const [cities, jar] = await Promise.all([listCities({ limit: 2000 }), cookies()]);
  const current = jar.get(EATING_CITY_COOKIE)?.value ?? null;
  return (
    <AppShell active="explore">
      <Page>
        <TopBar close="/" title="Choose a city" />
        <CityPicker
          current={current}
          cities={cities.map((city) => ({ slug: city.city_slug, name: cityName(city.city_slug), country: city.address_country, count: city.place_count }))}
        />
      </Page>
    </AppShell>
  );
}
