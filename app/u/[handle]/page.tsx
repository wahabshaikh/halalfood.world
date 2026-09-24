import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import ShareButton from "../../../src/components/share-button";
import { getProfileByHandle } from "../../../src/lib/preferences-repository";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { listPublicListsForUser } from "../../../src/lib/lists-repository";
import { listPassportVisits, listVisitedPlaces } from "../../../src/lib/visits";
import { buildFoodPassport } from "../../../src/lib/food-passport";
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
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath={`/u/${encodeURIComponent(handle)}`} />
        </main>
        <SiteFooter />
      </div>
    );

  const { profile, passport, places, lists, visitsPrivate, listsPrivate } = loaded.data;
  const name = profile.displayName ?? profile.handle;

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: name, path: `/u/${profile.handle}` },
          ]}
        />
        <div className="page-intro">
          <p className="eyebrow">DINER PROFILE</p>
          <h1>{name}</h1>
          <p className="diner-handle">@{profile.handle}</p>
          {profile.bio && <p className="lead">{profile.bio}</p>}
          {profile.homeCitySlug && (
            <p className="diner-home">Home city: {cityName(profile.homeCitySlug)}</p>
          )}
          <div className="detail-actions">
            <ShareButton
              url={`/u/${profile.handle}`}
              title={`${name} on Halalfood`}
              text={`${passport.distinctPlaces} halal places`}
              className="action share-button"
            />
          </div>
        </div>

        {visitsPrivate ? (
          <p className="insufficient-data">
            This diner keeps their visits private.
          </p>
        ) : (
          <>
            <section className="passport-stats">
              <div className="passport-stat">
                <strong>{passport.verifiedVisits}</strong>
                <span>Verified visits</span>
              </div>
              <div className="passport-stat">
                <strong>{passport.unverifiedVisits}</strong>
                <span>Self-reported</span>
              </div>
              <div className="passport-stat">
                <strong>{passport.distinctPlaces}</strong>
                <span>Places</span>
              </div>
              <div className="passport-stat">
                <strong>{passport.cities.length}</strong>
                <span>Cities</span>
              </div>
              <div className="passport-stat">
                <strong>{passport.cuisines.length}</strong>
                <span>Cuisines</span>
              </div>
            </section>
            <p className="approximate-note compact">
              There is no single reviewer score here on purpose. Credibility on
              Halalfood is contextual — it depends on the cuisine, the city and
              the quality of the evidence, not on one farmable number.
            </p>
          </>
        )}

        {!visitsPrivate && places.length > 0 && (
          <section className="coverage-block">
            <h2>Visited places</h2>
            <ul className="visited-list">
              {places.map((place) => (
                <li key={place.placeId}>
                  <a href={`/place/${place.placeId}`}>{place.name}</a>
                  <span className="visited-meta">{cityName(place.citySlug)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="coverage-block">
          <h2>Lists</h2>
          {listsPrivate ? (
            <p className="insufficient-data">This diner keeps their lists private.</p>
          ) : lists.length === 0 ? (
            <p className="insufficient-data">No public lists yet.</p>
          ) : (
            <ul className="list-index">
              {lists.map((list) => (
                <li key={list.id}>
                  <a href={`/list/${list.id}`}>
                    <strong>{list.title}</strong>
                    <span>
                      {list.itemCount} {list.itemCount === 1 ? "place" : "places"}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
