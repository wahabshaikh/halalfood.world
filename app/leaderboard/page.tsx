import type { Metadata } from "next";
import { cache } from "react";
import { ArrowUpRight, MapPinned, Plus, Trophy } from "lucide-react";
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

const TITLE = "Halalfood community curators";
const DESCRIPTION =
  "Meet the people helping the halalfood.world community build a more useful map with places, verifications, reviews, photos and ratings.";

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
    { name: "halalfood.world", path: "/" },
    { name: "Community", path: "/leaderboard" },
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
        <header className="page-intro leaderboard-intro">
          <div className="leaderboard-kicker">
            <span className="ui-badge ui-badge-accent">
              <Trophy size={12} aria-hidden="true" />
              Community board
            </span>
            <span>{formatCount(contributors.length)} ranked curators</span>
          </div>
          <p className="eyebrow">THE PEOPLE WHO KEEP IT USEFUL</p>
          <h1>Make the next visit easier.</h1>
          <p className="lead">
            Every useful listing, photo, review and halal verification gives another
            visitor a better answer when they are hungry somewhere new. Curators earn
            recognition for the quality signals they leave behind.
          </p>
          <div className="detail-actions">
            <a className="action primary" href="/add">
              <Plus size={15} aria-hidden="true" />
              Add a place
            </a>
            <a className="action" href="/">
              <MapPinned size={15} aria-hidden="true" />
              Explore the map
            </a>
            <a className="action" href="/guides">
              Read a city guide
            </a>
          </div>
          <p className="leaderboard-method">
            Score rewards places, verifications, reviews, photos and ratings:
            {" "}{CONTRIBUTOR_SCORE_WEIGHTS.placesAdded}× places ·{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.verificationsSubmitted}× verifications ·{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.reviews}× reviews ·{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.photos}× photos ·{" "}
            {CONTRIBUTOR_SCORE_WEIGHTS.ratings}× ratings.
          </p>
        </header>

        <section aria-labelledby="leaderboard-heading">
          <div className="section-bar">
            <div>
              <p className="eyebrow">RECOGNITION</p>
              <h2 id="leaderboard-heading">Top curators</h2>
            </div>
            <span className="section-bar-note">Updated with every contribution</span>
          </div>
          {contributors.length ? (
            <ol className="leaderboard-list">
              {contributors.map((contributor) => (
                <li
                  className={"leaderboard-row" + (contributor.rank <= 3 ? " is-top" : "")}
                  key={contributor.rank + "-" + contributor.displayName}
                >
                  <span className="leaderboard-rank" aria-label={"Rank " + contributor.rank}>
                    {contributor.rank <= 3 ? <Trophy size={14} aria-hidden="true" /> : contributor.rank}
                  </span>
                  <div className="leaderboard-contributor">
                    <strong>{contributor.displayName}</strong>
                    {contributor.rank <= 3 && <span>Map curator</span>}
                  </div>
                  <dl className="leaderboard-counts">
                    <ContributionCount label="Places" value={contributor.contributions.placesAdded} />
                    <ContributionCount label="Verifications" value={contributor.contributions.verificationsSubmitted} />
                    <ContributionCount label="Reviews" value={contributor.contributions.reviews} />
                    <ContributionCount label="Photos" value={contributor.contributions.photos} />
                    <ContributionCount label="Ratings" value={contributor.contributions.ratings} />
                  </dl>
                  <div className="leaderboard-score">
                    <strong>{formatCount(contributor.score)}</strong>
                    <span>points</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">
              Contributions will appear here as the community adds more halal places.
              <a href="/add"> Add a halal place</a>.
            </p>
          )}
        </section>

        <section className="leaderboard-cta" aria-labelledby="leaderboard-cta-title">
          <div>
            <p className="eyebrow">YOUR NEXT CONTRIBUTION</p>
            <h2 id="leaderboard-cta-title">Leave one useful detail behind.</h2>
            <p>
              Add a missing place, share a photo, write a review or submit halal evidence.
              Small actions compound into a better map.
            </p>
          </div>
          <div className="detail-actions">
            <a className="action" href="/add">
              Start contributing <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a className="action" href="/guides">
              Browse guides <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}