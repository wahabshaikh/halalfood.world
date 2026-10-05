import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "../../src/components/app-shell";
import { TopBar } from "../../src/components/kit";
import { EATING_CITY_COOKIE } from "../../src/lib/eating-city";
import { listCities } from "../../src/lib/places";
import { cityName } from "../../src/lib/place-view";
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
      <TopBar close="/" title="Choose a city" />
      <CityPicker
        current={current}
        cities={cities.map((city) => ({ slug: city.city_slug, name: cityName(city.city_slug), country: city.address_country, count: city.place_count }))}
      />
    </AppShell>
  );
}
