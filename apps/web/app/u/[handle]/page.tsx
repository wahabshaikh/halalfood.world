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
import { getViewerId } from "../../../src/lib/auth-session";
import { followCounts, getFollowStatus, relationTo } from "../../../src/lib/social-repository";
import FollowButton from "../../../src/components/follow-button";
import BlockButton from "../../../src/components/block-button";
import { SendRecLink } from "../../../src/components/send-rec-link";
import { PersonAvatar } from "../../../src/components/person";
import { avatarUrl, profileAccess } from "@halalfood/core/social";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
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

    const viewerId = await getViewerId();
    const relation = await relationTo(viewerId, profile.userId);
    const access = profileAccess(relation, profile.isPrivate);
    // A blocked viewer gets the same page as a missing account.
    if (!access.showsIdentity) return null;

    const [preferences, counts, follow] = await Promise.all([
      getPreferences(profile.userId),
      followCounts(profile.userId),
      viewerId && relation !== "self"
        ? getFollowStatus(viewerId, profile.userId)
        : Promise.resolve(null),
    ]);
    const showVisits = access.showsActivity && preferences.visibilityVisits === "public";
    const showLists = access.showsActivity && preferences.visibilityLists === "public";
    const [visits, places, lists] = await Promise.all([
      showVisits ? listPassportVisits(profile.userId) : Promise.resolve([]),
      showVisits ? listVisitedPlaces(profile.userId) : Promise.resolve([]),
      showLists ? listPublicListsForUser(profile.userId) : Promise.resolve([]),
    ]);

    return {
      profile,
      relation,
      follow,
      counts,
      passport: buildFoodPassport(visits),
      places: places.slice(0, 40),
      lists,
      // Private account: nothing about activity is shown until the viewer follows.
      locked: !access.showsActivity,
      visitsPrivate: access.showsActivity && preferences.visibilityVisits !== "public",
      listsPrivate: access.showsActivity && preferences.visibilityLists !== "public",
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
    description: loaded.data.locked
      ? `${name} is on Halalfood.`
      : `${loaded.data.passport.distinctPlaces} halal places across ${loaded.data.passport.cities.length} cities.`,
    alternates: { canonical: `/u/${loaded.data.profile.handle}` },
    // Private accounts, and any page whose content depends on who is looking,
    // stay out of search results.
    robots: loaded.data.profile.isPrivate ? { index: false, follow: false } : undefined,
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

  const { profile, relation, follow, counts, passport, places, lists, locked, visitsPrivate, listsPrivate } =
    loaded.data;
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
          <div className="flex items-center gap-4">
            <PersonAvatar
              name={name}
              avatarUrl={avatarUrl(profile.handle, profile.avatarKey)}
              size={72}
            />
            <div className="grid gap-1">
              <p className="font-semibold text-muted-foreground">
                @{profile.handle}
                {profile.isPrivate && (
                  <Badge variant="muted" className="ml-2 align-middle">
                    Private account
                  </Badge>
                )}
              </p>
              <p className="text-sm">
                <strong>{counts.followers}</strong> {counts.followers === 1 ? "follower" : "followers"}
                {" · "}
                <strong>{counts.following}</strong> following
              </p>
            </div>
          </div>
          {profile.bio && <Lead>{profile.bio}</Lead>}
          {profile.homeCitySlug && (
            <p className="text-sm">Home city: {cityName(profile.homeCitySlug)}</p>
          )}
          <div className="flex flex-wrap items-start gap-2.5">
            {relation === "self" ? (
              <Button asChild variant="outline" size="lg">
                <a href="/settings">Edit profile</a>
              </Button>
            ) : (
              <>
                <FollowButton handle={profile.handle} initialStatus={follow} />
                {relation === "following" && (
                  <SendRecLink to={profile.handle} label="Send a rec" variant="outline" className="h-11 rounded-full" />
                )}
                <BlockButton handle={profile.handle} />
              </>
            )}
            <ShareButton
              url={`/u/${profile.handle}`}
              title={`${name} on Halalfood`}
              text={`${name} on Halalfood`}
              variant="outline"
            />
          </div>
        </PageIntro>

        {locked && (
          <InsufficientData>
            This account is private. Follow {name} to see their visits and lists once they
            approve.
          </InsufficientData>
        )}

        {locked ? null : visitsPrivate ? (
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

        {!locked && (
        <Block title="Lists">
          {listsPrivate ? (
            <InsufficientData>This diner keeps their lists private.</InsufficientData>
          ) : lists.length === 0 ? (
            <InsufficientData>No public lists yet.</InsufficientData>
          ) : (
            <ListIndex lists={lists} />
          )}
        </Block>
        )}
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
