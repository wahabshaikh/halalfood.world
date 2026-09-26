import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@halalfood/ui/components/item";
import { Separator } from "@halalfood/ui/components/separator";
import { InitialsAvatar } from "../../../../src/components/blocks";
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
  Page,
  PageMain,
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
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath={`/creator/${platform}/${handle}`} />
        </PageMain>
        <SiteFooter />
      </Page>
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
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "halalfood.world", path: "/" },
            { name: "Community", path: "/leaderboard" },
            { name, path: creatorPath(creator.platform, creator.handle) },
          ]}
        />
        <div className="grid grid-cols-1 gap-7 pt-5 min-[900px]:grid-cols-[360px_minmax(0,1fr)] min-[900px]:gap-16">
          <div className="grid content-start gap-4">
            <Card className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-4 rounded-3xl px-6 py-7 shadow-lg ring-border">
              <div className="grid justify-items-center gap-1.5 text-center">
                <InitialsAvatar initials={initials} size={96} />
                <strong className="text-[22px]">{name}</strong>
                <span className="text-[13px] text-muted-foreground">
                  @{creator.handle} on {platformLabel}
                </span>
              </div>
              <div className="divide-y">
                <div className="py-2.5">
                  <strong className="block text-xl">{formatCount(creator.places.length)}</strong>
                  <span className="text-[11px] font-bold">{plural(creator.places.length, "Place")}</span>
                </div>
                <div className="py-2.5">
                  <strong className="block text-xl">{formatCount(cities.size)}</strong>
                  <span className="text-[11px] font-bold">{plural(cities.size, "City", "Cities")}</span>
                </div>
              </div>
            </Card>
            <Button asChild size="xl" variant="outline">
              <a
                href={profileUrl(creator.platform, creator.handle)}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                <HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden="true" />
                See them on {platformLabel}
              </a>
            </Button>
          </div>
          <div className="grid content-start gap-4">
            <h1 className="text-3xl">Where {name} has eaten</h1>
            <div className="grid gap-5.5">
              <Item className="items-start gap-4.5 p-0">
                <ItemMedia>
                  <HugeiconsIcon icon={PlayIcon} size={24} strokeWidth={1.6} aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-base font-extrabold">{formatCount(creator.places.length)} halal {plural(creator.places.length, "place")} filmed</ItemTitle>
                  <ItemDescription>Each one links to the {platformLabel} video people shared.</ItemDescription>
                </ItemContent>
              </Item>
              {topCities.length > 0 && (
              <Item className="items-start gap-4.5 p-0">
                <ItemMedia>
                  <HugeiconsIcon icon={Location01Icon} size={24} strokeWidth={1.6} aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-base font-extrabold">Mostly in {topCities.join(", ")}</ItemTitle>
                  <ItemDescription>Tap a place to see its halal checks.</ItemDescription>
                </ItemContent>
              </Item>
              )}
              <Item className="items-start gap-4.5 p-0">
                <ItemMedia>
                  <HugeiconsIcon icon={InformationCircleIcon} size={24} strokeWidth={1.6} aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-base font-extrabold">Built from shared links</ItemTitle>
                  <ItemDescription>This page is made from public {platformLabel} videos people linked to places. The name comes from {platformLabel}.</ItemDescription>
                </ItemContent>
              </Item>
            </div>
            <Separator className="my-4" />
            <PlaceGrid places={tiles} />
          </div>
        </div>
      </PageMain>
      <SiteFooter active="community" />
    </Page>
  );
}
