import { cookies } from "next/headers";
import { ArrowDown01Icon, MapsIcon, Notification03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { parseFilters, type Filter } from "@halalfood/core/halal";
import { AppShell } from "./app-shell";
import { BrandMark } from "./brand";
import { Avatar, Icon, IconLink, SectionTitle } from "./kit";
import { FilterChips, RestoreFilters } from "./kit-client";
import { ExploreList } from "./explore-list";
import { getViewerId } from "../lib/auth-session";
import { loginHref } from "../lib/signed-out";
import { EATING_CITY_COOKIE } from "../lib/eating-city";
import { loadExplore } from "../lib/explore";
import { cityName } from "../lib/place-view";
import { listCities, nearestCity, type City } from "../lib/places";
import { avatarUrl, getProfile } from "../lib/profiles";
import { getVisitorLocation } from "../lib/visitor-location";
import { breadcrumbJsonLd, canonical, jsonLdScript } from "../lib/seo";
import { ExploreExtras } from "./explore-extras";

export type ExploreSearchParams = Record<string, string | string[] | undefined>;

const PAGE = 30;

/** The city Explore opens on: the URL, then the saved choice, then the nearest, then the largest. */
export async function resolveCity(slug: string | null): Promise<{ city: City | null; cities: City[] }> {
  const cities = await listCities({ limit: 2000 });
  const find = (value: string | null | undefined) => (value ? (cities.find((city) => city.city_slug === value) ?? null) : null);
  if (slug) return { city: find(slug), cities };
  const saved = find((await cookies()).get(EATING_CITY_COOKIE)?.value);
  if (saved) return { city: saved, cities };
  const location = await getVisitorLocation();
  const near = location ? await nearestCity(location) : null;
  return { city: near ?? cities[0] ?? null, cities };
}

export async function ExploreScreen({ city, searchParams }: { city: City; searchParams: ExploreSearchParams }) {
  const viewerId = await getViewerId();
  const profile = viewerId ? await getProfile(viewerId).catch(() => null) : null;
  const rawFilters = typeof searchParams.filters === "string" ? searchParams.filters : undefined;
  const filters: Filter[] = rawFilters !== undefined ? parseFilters(rawFilters) : (profile?.defaultFilters ?? []);
  const friends = Boolean(viewerId) && searchParams.friends === "1";
  const location = await getVisitorLocation();
  const visitorCity = location ? await nearestCity(location).catch(() => null) : null;
  const near = location && visitorCity?.city_slug === city.city_slug ? { lat: location.lat, lng: location.lng } : null;

  const result = await loadExplore(viewerId, {
    citySlug: city.city_slug,
    bbox: null,
    near,
    filters,
    friends,
    offset: 0,
    limit: PAGE,
  });
  const query = new URLSearchParams({ city: city.city_slug, filters: filters.join(",") });
  if (friends) query.set("friends", "1");
  if (near) query.set("near", `${near.lat},${near.lng}`);
  const name = cityName(city.city_slug);
  const mapQuery = new URLSearchParams({ city: city.city_slug });
  if (filters.length) mapQuery.set("filters", filters.join(","));
  if (friends) mapQuery.set("friends", "1");

  return (
    <AppShell active="explore">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([
            {
              "@context": "https://schema.org",
              "@type": "ItemList",
              name: `Places in ${name}`,
              itemListElement: result.places.map((place, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: canonical(`/place/${place.id}`),
                name: place.name,
              })),
            },
            breadcrumbJsonLd([
              { name: "halalfood.world", path: "/" },
              { name, path: `/city/${city.city_slug}` },
            ]),
          ]),
        }}
      />
      {rawFilters === undefined && !viewerId && <RestoreFilters hasParam={false} />}
      <header className="grid gap-3.5 px-5 pt-[18px] pb-3">
        <div className="flex items-center justify-between gap-3">
          <a href="/cities" className="inline-flex min-h-11 items-center gap-1.5 text-foreground">
            <BrandMark size={26} className="md:hidden" />
            <span className="text-[22px] font-black tracking-tight">{name}</span>
            <Icon icon={ArrowDown01Icon} size={18} strokeWidth={2.4} />
            <span className="sr-only">Change city</span>
          </a>
          {viewerId ? (
            <div className="flex items-center gap-1 md:hidden">
              <IconLink href="/inbox" label="Inbox" icon={Notification03Icon} />
              <a href="/me" aria-label="Your profile">
                <Avatar name={profile?.displayName ?? "You"} seed={viewerId} src={profile ? avatarUrl(profile.avatarKey, profile.handle) : null} />
              </a>
            </div>
          ) : (
            <a
              href={loginHref(`/city/${city.city_slug}`)}
              className="inline-flex min-h-10 items-center rounded-full border border-input px-4 text-sm font-extrabold text-foreground"
            >
              Sign in
            </a>
          )}
        </div>
        <a
          href={`/search?city=${city.city_slug}`}
          className="flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-[18px] text-[15px] font-semibold text-muted-foreground"
        >
          <Icon icon={Search01Icon} className="text-foreground" />
          Search places, dishes, people
        </a>
      </header>

      <div className="grid gap-[26px] pt-1">
        <ExploreExtras citySlug={city.city_slug} cityLabel={name} viewerId={viewerId} />
        <section aria-labelledby="places-title" className="grid gap-2.5">
          <div className="px-5">
            <SectionTitle id="places-title">{near ? "Places near you" : `Places in ${name}`}</SectionTitle>
          </div>
          <FilterChips filters={filters} friends={friends} showFriends={Boolean(viewerId)} />
          <div className="px-5">
            <ExploreList initial={result.places} total={result.total} query={query.toString()} signedIn={Boolean(viewerId)} pageSize={PAGE} />
          </div>
        </section>
      </div>

      <a
        href={`/map?${mapQuery}`}
        className="fixed bottom-[calc(102px+env(safe-area-inset-bottom))] left-1/2 z-30 inline-flex h-[46px] -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 text-[15px] font-extrabold text-background shadow-xl md:bottom-8"
      >
        Map
        <Icon icon={MapsIcon} size={18} />
      </a>
    </AppShell>
  );
}
