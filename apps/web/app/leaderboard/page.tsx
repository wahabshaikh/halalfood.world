import { cache } from "react";
import type { Metadata } from "next";
import {
  CONTRIBUTOR_LEADERBOARD_LIMIT,
  CONTRIBUTOR_SCORE_WEIGHTS,
  listContributors,
  type RankedContributor,
} from "../../src/lib/contributor-leaderboard";
import { creatorPath, listTopCreators, MEDIA_PLATFORM_LABELS } from "../../src/lib/media-links";
import {
  breadcrumbJsonLd,
  canonical,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
  plural,
} from "../../src/lib/seo";
import {
  ExploreTabs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { Illustration } from "../../src/components/art";
import { Separator } from "@halalfood/ui/components/separator";
import { cn } from "@halalfood/ui/lib/utils";
import {
  CityCard,
  CityGrid,
  EmptyState,
  InitialsAvatar,
  PromoCard,
  TextLink,
} from "../../src/components/blocks";
import { SectionTitle } from "../../src/components/place-tile";
import { loadOrDegrade } from "../../src/lib/load";

const TITLE = "The halalfood.world community";
const DESCRIPTION =
  "Meet the people who add places, check them in person, share photos and write reviews so the next person can eat with confidence.";

const loadLeaderboard = cache(() =>
  loadOrDegrade(() => listContributors(CONTRIBUTOR_LEADERBOARD_LIMIT)),
);

const loadCreators = cache(async () => {
  try {
    return await listTopCreators(8);
  } catch {
    return [];
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadLeaderboard();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/leaderboard" },
    robots: loaded.status === "ok" ? undefined : { index: false, follow: true },
    openGraph: {
      type: "website",
      url: canonical("/leaderboard"),
      title: TITLE,
      description: DESCRIPTION,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

function initials(name: string) {
  return (
    name
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "H"
  );
}

function summary(contributor: RankedContributor) {
  const { placesAdded, verificationsSubmitted, reviews, photos, ratings } = contributor.contributions;
  const parts = [
    placesAdded && `${formatCount(placesAdded)} ${plural(placesAdded, "place")} added`,
    verificationsSubmitted && `${formatCount(verificationsSubmitted)} ${plural(verificationsSubmitted, "check")}`,
    reviews && `${formatCount(reviews)} ${plural(reviews, "review")}`,
    photos && `${formatCount(photos)} ${plural(photos, "photo")}`,
    ratings && `${formatCount(ratings)} ${plural(ratings, "signal")}`,
  ].filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "Just getting started";
}

const AVATAR_TINTS = ["#F6C9B0", "#CFE0F2", "#FBE3A8", "#CDE8D8", "#F4CFE0", "#E3D6F2"];

export default async function LeaderboardPage() {
  const [loaded, creators] = await Promise.all([loadLeaderboard(), loadCreators()]);
  if (loaded.status !== "ok")
    return (
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath="/leaderboard" />
        </PageMain>
        <SiteFooter active="community" />
      </Page>
    );

  const contributors = loaded.data;
  const podium = contributors.slice(0, 3);
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(
    (item): item is RankedContributor => Boolean(item),
  );
  const rest = contributors.slice(3);
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: "Community", path: "/leaderboard" },
  ];

  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(trail)) }}
        />
        <ExploreTabs active="community" />
        <PageIntro
          title="Community"
          lead="The people who add places, check them in person and share what they saw, so the next person can decide."
        />

        <section
          className="mb-6 flex items-center gap-4.5 rounded-3xl bg-warning-muted p-6 text-warning-foreground"
          aria-labelledby="cup-title"
        >
          <Illustration name="cup" size={64} />
          <div>
            <h2 id="cup-title" className="text-xl text-foreground">
              Top helpers
            </h2>
            <p>
              {contributors.length
                ? `${formatCount(contributors.length)} ${plural(contributors.length, "person", "people")} ranked by how much they’ve helped.`
                : "Be the first on the board."}
            </p>
          </div>
        </section>

        {podiumOrder.length > 0 && (
          <ol className="mb-6 grid grid-cols-3 items-end gap-3.5" aria-label="Top three">
            {podiumOrder.map((contributor) => (
              <li key={contributor.rank} className="grid justify-items-center gap-2 text-center">
                <InitialsAvatar
                  initials={initials(contributor.displayName)}
                  tint={AVATAR_TINTS[contributor.rank % AVATAR_TINTS.length]}
                  size={contributor.rank === 1 ? 64 : 52}
                />
                <strong>{contributor.displayName}</strong>
                <div
                  className={cn(
                    "grid w-full content-start justify-items-center rounded-t-2xl pt-3 font-extrabold",
                    contributor.rank === 1 ? "bg-foreground text-background" : "bg-secondary",
                  )}
                  style={{ height: contributor.rank === 1 ? 118 : contributor.rank === 2 ? 92 : 72 }}
                >
                  <b className="text-[28px]">{contributor.rank}</b>
                  <span>{formatCount(contributor.score)} pts</span>
                </div>
              </li>
            ))}
          </ol>
        )}

        {rest.length > 0 && (
          <ol className="divide-y" start={4}>
            {rest.map((contributor) => (
              <li
                className="grid grid-cols-[32px_auto_minmax(0,1fr)_auto] items-center gap-3.5 py-3.5"
                key={contributor.rank + "-" + contributor.displayName}
              >
                <span className="text-center font-extrabold">{contributor.rank}</span>
                <InitialsAvatar
                  initials={initials(contributor.displayName)}
                  tint={AVATAR_TINTS[contributor.rank % AVATAR_TINTS.length]}
                />
                <div>
                  <strong className="block text-[15px]">{contributor.displayName}</strong>
                  <small className="text-[13px] text-muted-foreground">{summary(contributor)}</small>
                </div>
                <span className="text-right font-extrabold">{formatCount(contributor.score)}</span>
              </li>
            ))}
          </ol>
        )}

        {!contributors.length && (
          <EmptyState>
            Nobody’s on the board yet. <a href="/add">Add a place</a> to be the first.
          </EmptyState>
        )}

        <Separator className="my-8" />
        <section aria-labelledby="points-title">
          <SectionTitle id="points-title" className="mb-2">
            How points work
          </SectionTitle>
          <p className="text-muted-foreground">
            Points: {CONTRIBUTOR_SCORE_WEIGHTS.placesAdded} for a place you add,{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.verificationsSubmitted} for a halal check,{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.reviews} for a review, {CONTRIBUTOR_SCORE_WEIGHTS.photos} for a
            photo and {CONTRIBUTOR_SCORE_WEIGHTS.ratings} for a visit signal.
            Points say thanks for helping. They never change how anyone’s checks are
            reviewed, and trust roles are earned separately through accurate
            contributions.
          </p>
        </section>

        {creators.length > 0 && (
          <>
            <Separator className="my-8" />
            <section aria-labelledby="creators-title">
              <SectionTitle id="creators-title" className="mb-3.5">
                Creators people have linked
              </SectionTitle>
              <CityGrid>
                {creators.map((creator) => (
                  <li key={creator.platform + creator.handle}>
                    <CityCard
                      href={creatorPath(creator.platform, creator.handle)}
                      mark={
                        <span aria-hidden="true">
                          {initials(creator.authorName || creator.handle)}
                        </span>
                      }
                      title={creator.authorName || "@" + creator.handle}
                      meta={
                        <>
                          {MEDIA_PLATFORM_LABELS[creator.platform]} ·{" "}
                          {formatCount(creator.placeCount)} {plural(creator.placeCount, "place")}
                        </>
                      }
                    />
                  </li>
                ))}
              </CityGrid>
            </section>
          </>
        )}

        <Separator className="my-8" />
        <section aria-labelledby="cta-title">
          <PromoCard
            tone="honey"
            art="vouches"
            titleId="cta-title"
            title="Eaten somewhere lately?"
            description={
              <>
                <p className="mb-3">
                  Open the place and tap “I’ve been here, let me check”. It takes about a minute.
                </p>
                <TextLink href="/map">Find the place</TextLink>
              </>
            }
          />
        </section>
      </PageMain>
      <SiteFooter active="community" />
    </Page>
  );
}
