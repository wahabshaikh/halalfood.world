import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon, LinkSquare02Icon, Location01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import {
  creatorPath,
  getCreatorProfile,
  isMediaPlatform,
  MEDIA_PLATFORM_LABELS,
  normalizeHandle,
  type MediaPlatform,
} from "../../../../src/lib/media-links";
import { loadOrDegrade } from "../../../../src/lib/load";
import { cityName, formatCount, plural } from "../../../../src/lib/seo";
import {
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../../src/components/site-chrome";
import { PlaceGrid } from "../../../../src/components/place-tile";

const loadCreator = cache(async (rawPlatform: string, rawHandle: string) => {
  const handle = normalizeHandle(decodeURIComponent(rawHandle));
  if (!isMediaPlatform(rawPlatform) || !handle) return { status: "missing" as const };
  return loadOrDegrade(() => getCreatorProfile(rawPlatform, handle));
});

function profileUrl(platform: MediaPlatform, handle: string) {
  if (platform === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (platform === "youtube") return `https://www.youtube.com/@${handle}`;
  return `https://www.instagram.com/${handle}/`;
}

type Params = Promise<{ platform: string; handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { platform, handle } = await params;
  const loaded = await loadCreator(platform, handle);
  if (loaded.status !== "ok")
    return { title: "Creator not found", robots: { index: false, follow: true } };
  const creator = loaded.data;
  const name = creator.authorName || "@" + creator.handle;
  const title = `${name}'s halal food picks`;
  const description = `${formatCount(creator.places.length)} halal ${plural(creator.places.length, "place")} ${name} has filmed on ${MEDIA_PLATFORM_LABELS[creator.platform]}.`;
  return {
    title,
    description,
    alternates: { canonical: creatorPath(creator.platform, creator.handle) },
  };
}

export default async function CreatorPage({ params }: { params: Params }) {
  const { platform, handle } = await params;
  const loaded = await loadCreator(platform, handle);
  if (loaded.status === "missing") notFound();
  if (loaded.status === "error")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath={`/creator/${platform}/${handle}`} />
        </main>
        <SiteFooter />
      </div>
    );

  const creator = loaded.data;
  const name = creator.authorName || "@" + creator.handle;
  const initials = (creator.authorName || creator.handle)
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "HF";
  const cities = new Set(creator.places.map((place) => place.citySlug));
  const topCities = [...cities].slice(0, 3).map(cityName);
  const platformLabel = MEDIA_PLATFORM_LABELS[creator.platform];
  const tiles = creator.places.map((place) => ({
    id: place.placeId,
    name: place.placeName,
    city_slug: place.citySlug,
    street_address: place.streetAddress,
    address_locality: place.addressLocality,
    rating_value: place.ratingValue,
    review_count: place.reviewCount,
  }));

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Breadcrumbs
          trail={[
            { name: "halalfood.world", path: "/" },
            { name: "Community", path: "/leaderboard" },
            { name, path: creatorPath(creator.platform, creator.handle) },
          ]}
        />
        <div className="creator-layout">
          <div className="stack">
            <div className="host-card">
              <div className="host-card-id">
                <span className="avatar is-lg" aria-hidden="true">
                  {initials}
                </span>
                <strong>{name}</strong>
                <span>
                  @{creator.handle} on {platformLabel}
                </span>
              </div>
              <div className="host-card-stats">
                <div>
                  <strong>{formatCount(creator.places.length)}</strong>
                  <span>{plural(creator.places.length, "Place")}</span>
                </div>
                <div>
                  <strong>{formatCount(cities.size)}</strong>
                  <span>{plural(cities.size, "City", "Cities")}</span>
                </div>
              </div>
            </div>
            <a
              className="btn btn-outline"
              href={profileUrl(creator.platform, creator.handle)}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              <HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden="true" />
              See them on {platformLabel}
            </a>
          </div>
          <div className="stack">
            <h1 style={{ fontSize: 30 }}>Where {name} has eaten</h1>
            <div className="feature-list">
              <div className="feature">
                <HugeiconsIcon icon={PlayIcon} size={24} strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <h3>
                    {formatCount(creator.places.length)} halal {plural(creator.places.length, "place")} filmed
                  </h3>
                  <p>Each one links to the {platformLabel} video people shared.</p>
                </div>
              </div>
              {topCities.length > 0 && (
                <div className="feature">
                  <HugeiconsIcon icon={Location01Icon} size={24} strokeWidth={1.6} aria-hidden="true" />
                  <div>
                    <h3>Mostly in {topCities.join(", ")}</h3>
                    <p>Tap a place to see its halal checks.</p>
                  </div>
                </div>
              )}
              <div className="feature">
                <HugeiconsIcon icon={InformationCircleIcon} size={24} strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <h3>Built from shared links</h3>
                  <p>
                    This page is made from public {platformLabel} videos people linked to
                    places. The name comes from {platformLabel}.
                  </p>
                </div>
              </div>
            </div>
            <hr className="rule" />
            <PlaceGrid places={tiles} />
          </div>
        </div>
      </main>
      <SiteFooter active="community" />
    </div>
  );
}
