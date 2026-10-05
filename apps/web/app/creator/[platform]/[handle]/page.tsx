import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "../../../../src/components/app-shell";
import { Avatar, Page, StatusPill, TopBar } from "../../../../src/components/kit";
import { MEDIA_PLATFORM_LABELS, getCreatorProfile, isMediaPlatform, normalizeHandle } from "../../../../src/lib/media-links";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ platform: string; handle: string }> };

async function load(props: Props) {
  const { platform, handle: raw } = await props.params;
  const handle = normalizeHandle(decodeURIComponent(raw));
  if (!isMediaPlatform(platform) || !handle) return null;
  return getCreatorProfile(platform, handle);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const creator = await load(props).catch(() => null);
  if (!creator) return { title: "Creator not found", robots: { index: false } };
  return {
    title: `@${creator.handle} on ${MEDIA_PLATFORM_LABELS[creator.platform]}`,
    description: `${creator.places.length} halal places from @${creator.handle}’s videos, each with its community status.`,
    alternates: { canonical: `/creator/${creator.platform}/${encodeURIComponent(creator.handle)}` },
  };
}

export default async function CreatorPage(props: Props) {
  const creator = await load(props);
  if (!creator) notFound();
  return (
    <AppShell active="explore">
      <Page>
        <TopBar back="/" />
        <div className="grid gap-5 md:gap-6">
          <div className="flex items-center gap-4">
            <Avatar name={creator.authorName ?? creator.handle} seed={`${creator.platform}:${creator.handle}`} size={72} />
            <div className="grid gap-0.5">
              <h1 className="text-[24px] leading-tight font-black">@{creator.handle}</h1>
              <p className="text-sm font-semibold text-muted-foreground">
                {MEDIA_PLATFORM_LABELS[creator.platform]} · {creator.places.length} {creator.places.length === 1 ? "place" : "places"}
              </p>
            </div>
          </div>
          <p className="rounded-2xl bg-muted px-4 py-3 text-[13px] font-semibold text-subtle-foreground md:max-w-2xl">
            A video is taste, not a halal check. Each place’s status comes from people who eat there.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5">
            {creator.places.map((place) => (
              <a key={place.placeId} href={`/place/${place.placeId}`} className="grid gap-1.5 text-foreground">
                <span className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-2xl bg-foreground/85 text-background">
                  {place.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={place.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                  )}
                </span>
                <strong className="truncate text-[15px] font-extrabold">{place.placeName}</strong>
                <StatusPill status={place.status} short className="w-fit" />
              </a>
            ))}
          </div>
        </div>
      </Page>
    </AppShell>
  );
}
