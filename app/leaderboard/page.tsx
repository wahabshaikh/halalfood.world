import type { Metadata } from "next";
import { cache } from "react";
import {
  CONTRIBUTOR_LEADERBOARD_LIMIT,
  CONTRIBUTOR_SCORE_WEIGHTS,
  listContributors,
} from "../../src/lib/contributor-leaderboard";
import {
  breadcrumbJsonLd,
  canonical,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
  plural,
} from "../../src/lib/seo";
import {
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { loadOrDegrade } from "../../src/lib/load";

const TITLE = "Halal community contributor leaderboard";
const DESCRIPTION =
  "Celebrate the people helping the Halalfood community grow a more useful halal food map with places, verifications, reviews, photos and ratings.";

const loadLeaderboard = cache(() =>
  loadOrDegrade(() => listContributors(CONTRIBUTOR_LEADERBOARD_LIMIT)),
);

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

function ContributionCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatCount(value)}</dd>
    </div>
  );
}

export default async function LeaderboardPage() {
  const loaded = await loadLeaderboard();
  if (loaded.status !== "ok")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath="/leaderboard" />
        </main>
        <SiteFooter />
      </div>
    );

  const contributors = loaded.data;
  const trail = [
    { name: "Halalfood", path: "/" },
    { name: "Contributors", path: "/leaderboard" },
  ];

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(breadcrumbJsonLd(trail)),
          }}
        />
        <Breadcrumbs trail={trail} />
        <header className="page-intro">
          <p className="eyebrow">UMMAH CONTRIBUTIONS</p>
          <h1>Halal community contributors</h1>
          <p className="lead">
            A thank-you to the people helping everyone find and trust more halal
            food. Every useful place, verification, review, photo and rating
            strengthens the community map.
          </p>
          <p className="leaderboard-method">
            Points reward effort: places added × {CONTRIBUTOR_SCORE_WEIGHTS.placesAdded},
            verifications × {CONTRIBUTOR_SCORE_WEIGHTS.verificationsSubmitted}, reviews × {CONTRIBUTOR_SCORE_WEIGHTS.reviews},
            photos × {CONTRIBUTOR_SCORE_WEIGHTS.photos}, ratings × {CONTRIBUTOR_SCORE_WEIGHTS.ratings}.
          </p>
        </header>

        <section aria-labelledby="leaderboard-heading">
          <h2 id="leaderboard-heading">
            {contributors.length
              ? `Top ${formatCount(contributors.length)} ${plural(contributors.length, "contributor")}`
              : "The community board"}
          </h2>
          {contributors.length ? (
            <ol className="leaderboard-list">
              {contributors.map((contributor) => (
                <li className="leaderboard-row" key={`${contributor.rank}-${contributor.displayName}`}>
                  <span
                    className="leaderboard-rank"
                    aria-label={`Rank ${contributor.rank}`}
                  >
                    {contributor.rank}
                  </span>
                  <div className="leaderboard-contributor">
                    <strong>{contributor.displayName}</strong>
                  </div>
                  <dl className="leaderboard-counts">
                    <ContributionCount
                      label="Places added"
                      value={contributor.contributions.placesAdded}
                    />
                    <ContributionCount
                      label="Verifications"
                      value={contributor.contributions.verificationsSubmitted}
                    />
                    <ContributionCount
                      label="Reviews"
                      value={contributor.contributions.reviews}
                    />
                    <ContributionCount
                      label="Photos"
                      value={contributor.contributions.photos}
                    />
                    <ContributionCount
                      label="Ratings"
                      value={contributor.contributions.ratings}
                    />
                  </dl>
                  <div className="leaderboard-score">
                    <strong>{formatCount(contributor.score)}</strong>
                    <span>total score</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">
              Contributions will appear here as the ummah adds more halal places
              and shares helpful community knowledge. <a href="/add">Add a halal place</a>.
            </p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
