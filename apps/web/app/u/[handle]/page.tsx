import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  Page,
  Lead,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { Block, ListIndex, RowList, StatGrid, StatTile } from "../../../src/components/blocks";
import { InsufficientData, Note } from "../../../src/components/section";
import ShareButton from "../../../src/components/share-button";
import { getProfileByHandle } from "../../../src/lib/preferences-repository";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { listPublicListsForUser } from "../../../src/lib/lists-repository";
import { listPassportVisits, listVisitedPlaces } from "../../../src/lib/visits";
import { buildFoodPassport } from "@halalfood/core/food-passport";
import { loadOrDegrade } from "../../../src/lib/load";
import { cityName } from "../../../src/lib/seo";

/**
 * A public diner profile, addressed by pseudonym.
 *
 * Contribution history is shown as context — cities explored, cuisines,
 * verified visits, lists — and deliberately not as a single reputation score.
 * A number like that can be farmed, and would be read as religious authority
 * it does not have.
 */
async function load(handle: string) {
  if (!/^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/.test(handle))
    return { status: "missing" as const };
  return loadOrDegrade(async () => {
    const profile = await getProfileByHandle(handle);
    if (!profile) return null;

    const preferences = await getPreferences(profile.userId);
    const [visits, places, lists] = await Promise.all([
      preferences.visibilityVisits === "public"
        ? listPassportVisits(profile.userId)
        : Promise.resolve([]),
      preferences.visibilityVisits === "public"
        ? listVisitedPlaces(profile.userId)
        : Promise.resolve([]),
      preferences.visibilityLists === "public"
        ? listPublicListsForUser(profile.userId)
        : Promise.resolve([]),
    ]);

    return {
      profile,
      passport: buildFoodPassport(visits),
      places: places.slice(0, 40),
      lists,
      visitsPrivate: preferences.visibilityVisits !== "public",
      listsPrivate: preferences.visibilityLists !== "public",
    };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const loaded = await load(handle);
  if (loaded.status !== "ok")
    return { title: "Diner not found", robots: { index: false, follow: true } };
  const name = loaded.data.profile.displayName ?? loaded.data.profile.handle;
  return {
    title: `${name} on Halalfood`,
    description: `${loaded.data.passport.distinctPlaces} halal places across ${loaded.data.passport.cities.length} cities.`,
    alternates: { canonical: `/u/${loaded.data.profile.handle}` },
  };
}

export default async function DinerProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const loaded = await load(handle);
  if (loaded.status === "missing") notFound();
  if (loaded.status === "error")
    return (
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath={`/u/${encodeURIComponent(handle)}`} />
        </PageMain>
        <SiteFooter />
      </Page>
    );

  const { profile, passport, places, lists, visitsPrivate, listsPrivate } = loaded.data;
  const name = profile.displayName ?? profile.handle;

  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: name, path: `/u/${profile.handle}` },
          ]}
        />
        <PageIntro eyebrow="DINER PROFILE" title={name}>
          <p className="font-semibold text-muted-foreground">@{profile.handle}</p>
          {profile.bio && <Lead>{profile.bio}</Lead>}
          {profile.homeCitySlug && (
            <p className="text-sm">Home city: {cityName(profile.homeCitySlug)}</p>
          )}
          <div className="flex flex-wrap gap-2.5">
            <ShareButton
              url={`/u/${profile.handle}`}
              title={`${name} on Halalfood`}
              text={`${passport.distinctPlaces} halal places`}
              variant="outline"
            />
          </div>
        </PageIntro>

        {visitsPrivate ? (
          <InsufficientData>This diner keeps their visits private.</InsufficientData>
        ) : (
          <>
            <StatGrid>
              <StatTile value={passport.verifiedVisits} label="Verified visits" />
              <StatTile value={passport.unverifiedVisits} label="Self-reported" />
              <StatTile value={passport.distinctPlaces} label="Places" />
              <StatTile value={passport.cities.length} label="Cities" />
              <StatTile value={passport.cuisines.length} label="Cuisines" />
            </StatGrid>
            <Note>
              There is no single reviewer score here on purpose. Credibility on
              Halalfood is contextual — it depends on the cuisine, the city and
              the quality of the evidence, not on one farmable number.
            </Note>
          </>
        )}

        {!visitsPrivate && places.length > 0 && (
          <Block title="Visited places">
            <RowList>
              {places.map((place) => (
                <li key={place.placeId}>
                  <a href={`/place/${place.placeId}`} className="font-semibold hover:underline">
                    {place.name}
                  </a>
                  <span className="text-xs text-muted-foreground">{cityName(place.citySlug)}</span>
                </li>
              ))}
            </RowList>
          </Block>
        )}

        <Block title="Lists">
          {listsPrivate ? (
            <InsufficientData>This diner keeps their lists private.</InsufficientData>
          ) : lists.length === 0 ? (
            <InsufficientData>No public lists yet.</InsufficientData>
          ) : (
            <ListIndex lists={lists} />
          )}
        </Block>
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
