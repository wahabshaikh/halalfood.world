import type { Metadata } from "next";
import { cache } from "react";
import {
  CONTRIBUTOR_LEADERBOARD_LIMIT,
  CONTRIBUTOR_LEVELS,
  CONTRIBUTOR_SCORE_WEIGHTS,
  contributorLevel,
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
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { Illustration } from "../../src/components/art";
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

function LevelPill({ score }: { score: number }) {
  const level = contributorLevel(score);
  const tone = level.name === "Keeper" ? " is-keeper" : level.name === "Trusted" ? " is-trusted" : "";
  return <span className={"level-pill" + tone}>{level.name}</span>;
}

const AVATAR_TINTS = ["#F6C9B0", "#CFE0F2", "#FBE3A8", "#CDE8D8", "#F4CFE0", "#E3D6F2"];

export default async function LeaderboardPage() {
  const [loaded, creators] = await Promise.all([loadLeaderboard(), loadCreators()]);
  if (loaded.status !== "ok")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath="/leaderboard" />
        </main>
        <SiteFooter active="community" />
      </div>
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
    <div className="page">
      <SiteHeader />
      <main className="page-main page-narrow">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(trail)) }}
        />
        <ExploreTabs active="community" />
        <header className="page-intro">
          <h1>Community</h1>
          <p className="lead">
            The people who add places, check them in person and share what they saw, so the
            next person can decide.
          </p>
        </header>

        <section className="cup-card" aria-labelledby="cup-title">
          <Illustration name="cup" size={64} />
          <div>
            <h2 id="cup-title">Top helpers</h2>
            <p>
              {contributors.length
                ? `${formatCount(contributors.length)} ${plural(contributors.length, "person", "people")} ranked by how much they’ve helped.`
                : "Be the first on the board."}
            </p>
          </div>
        </section>

        {podiumOrder.length > 0 && (
          <ol className="podium" aria-label="Top three">
            {podiumOrder.map((contributor) => (
              <li key={contributor.rank} className={contributor.rank === 1 ? "is-first" : undefined}>
                <span
                  className="avatar"
                  aria-hidden="true"
                  style={{
                    width: contributor.rank === 1 ? 64 : 52,
                    height: contributor.rank === 1 ? 64 : 52,
                    background: AVATAR_TINTS[contributor.rank % AVATAR_TINTS.length],
                  }}
                >
                  {initials(contributor.displayName)}
                </span>
                <strong>{contributor.displayName}</strong>
                <LevelPill score={contributor.score} />
                <div className="podium-block" style={{ height: contributor.rank === 1 ? 118 : contributor.rank === 2 ? 92 : 72 }}>
                  <b>{contributor.rank}</b>
                  <span>{formatCount(contributor.score)} pts</span>
                </div>
              </li>
            ))}
          </ol>
        )}

        {rest.length > 0 && (
          <ol className="rank-list" start={4}>
            {rest.map((contributor) => (
              <li className="rank-row" key={contributor.rank + "-" + contributor.displayName}>
                <span className="rank">{contributor.rank}</span>
                <span
                  className="avatar"
                  aria-hidden="true"
                  style={{ background: AVATAR_TINTS[contributor.rank % AVATAR_TINTS.length] }}
                >
                  {initials(contributor.displayName)}
                </span>
                <div>
                  <strong>
                    {contributor.displayName}
                    <LevelPill score={contributor.score} />
                  </strong>
                  <small>{summary(contributor)}</small>
                </div>
                <span className="points">{formatCount(contributor.score)}</span>
              </li>
            ))}
          </ol>
        )}

        {!contributors.length && (
          <p className="empty-state">
            Nobody’s on the board yet. <a href="/add">Add a place</a> to be the first.
          </p>
        )}

        <hr className="rule" />
        <section aria-labelledby="levels-title">
          <h2 id="levels-title" className="section-title">
            Levels
          </h2>
          <div className="level-grid">
            {CONTRIBUTOR_LEVELS.map((level) => (
              <div className="level-card" key={level.name}>
                <span>{formatCount(level.minScore)}+ points</span>
                <strong>{level.name}</strong>
                <p>{level.blurb}</p>
              </div>
            ))}
          </div>
          <p className="muted">
            Points: {CONTRIBUTOR_SCORE_WEIGHTS.placesAdded} for a place you add,{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.verificationsSubmitted} for a halal check,{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.reviews} for a review, {CONTRIBUTOR_SCORE_WEIGHTS.photos} for a
            photo and {CONTRIBUTOR_SCORE_WEIGHTS.ratings} for a visit signal.
          </p>
        </section>

        {creators.length > 0 && (
          <>
            <hr className="rule" />
            <section aria-labelledby="creators-title">
              <h2 id="creators-title" className="section-title" style={{ marginBottom: 14 }}>
                Creators people have linked
              </h2>
              <ul className="city-grid">
                {creators.map((creator) => (
                  <li key={creator.platform + creator.handle}>
                    <a className="city-card" href={creatorPath(creator.platform, creator.handle)}>
                      <span className="city-card-mark" aria-hidden="true">
                        {initials(creator.authorName || creator.handle)}
                      </span>
                      <span>
                        <strong>{creator.authorName || "@" + creator.handle}</strong>
                        <small>
                          {MEDIA_PLATFORM_LABELS[creator.platform]} · {formatCount(creator.placeCount)}{" "}
                          {plural(creator.placeCount, "place")}
                        </small>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <hr className="rule" />
        <section className="promo-card is-honey" aria-labelledby="cta-title">
          <Illustration name="vouches" size={88} />
          <div>
            <h2 id="cta-title">Eaten somewhere lately?</h2>
            <p>Open the place and tap “I’ve been here, let me check”. It takes about a minute.</p>
            <a className="link-underline" href="/map">
              Find the place
            </a>
          </div>
        </section>
      </main>
      <SiteFooter active="community" />
    </div>
  );
}
