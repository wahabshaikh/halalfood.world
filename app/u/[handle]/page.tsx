import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LockIcon } from "@hugeicons/core-free-icons";
import { formatSubscriberCount, formatVideoTimestamp } from "@/lib/core/creators";
import { normalizeHandle } from "@/lib/core/people";
import { AppShell } from "@/components/hf/app-shell";
import { Avatar, Icon, Page, PlaceArt, StatusPill, TopBar } from "@/components/hf/kit";
import { VisitCard } from "@/components/hf/visit-card";
import { getViewerId } from "@/lib/auth-session";
import { creatorVerifiedPlaces, getCreatorChannel, videoMonth } from "@/lib/creator-profiles";
import { KIND_LABEL } from "@/lib/lists";
import { listConnections } from "@/lib/people";
import { cityName, photoUrl } from "@/lib/place-view";
import { avatarUrl } from "@/lib/profiles";
import { loadPublicProfile } from "@/lib/public-profile";
import { loginHref } from "@/lib/signed-out";
import { canonical, jsonLdScript } from "@/lib/seo";
import { visitJson } from "@/lib/visit-json";
import { ProfileActions, ProfileMenu } from "./profile-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(raw: string, viewerId: string | null) {
  const handle = normalizeHandle(decodeURIComponent(raw));
  return handle ? loadPublicProfile(handle, viewerId) : null;
}

/** Where someone who runs the channel asks to claim the profile, until claiming is self-serve. */
function claimHref(handle: string) {
  const subject = `Claim @${handle} on halalfood.world`;
  const body = `Salam! I run the YouTube channel behind https://halalfood.world/u/${handle} and would like to claim it.`;
  return `mailto:salam@halalfood.world?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).handle, null).catch(() => null);
  if (!data) return { title: "Not found", robots: { index: false } };
  const channel = await getCreatorChannel(data.profile.userId).catch(() => null);
  return {
    title: `${data.profile.displayName} (@${data.profile.handle})`,
    description:
      data.profile.bio ??
      (channel ? `Halal places ${data.profile.displayName} has shown on YouTube, on halalfood.world.` : `Where ${data.profile.displayName} eats, on halalfood.world.`),
    alternates: { canonical: `/u/${data.profile.handle}` },
    robots: data.profile.isPrivate ? { index: false } : undefined,
  };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const viewerId = await getViewerId();
  const data = await load((await params).handle, viewerId);
  if (!data) notFound();
  const tab = (await searchParams).tab;
  const { profile, relation } = data;
  const city = profile.homeCitySlug ? cityName(profile.homeCitySlug) : null;
  const connections =
    data.canView && (tab === "followers" || tab === "following") ? await listConnections(profile.userId, tab) : null;
  const channel = await getCreatorChannel(profile.userId).catch(() => null);
  const verified = channel && data.canView ? await creatorVerifiedPlaces(profile.userId).catch(() => []) : [];
  const unclaimed = channel !== null && !channel.claimed;

  return (
    <AppShell active={relation === "self" ? "you" : "friends"}>
      {!profile.isPrivate && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript([
              {
                "@context": "https://schema.org",
                "@type": "ProfilePage",
                url: canonical(`/u/${profile.handle}`),
                mainEntity: {
                  "@type": "Person",
                  name: profile.displayName,
                  alternateName: `@${profile.handle}`,
                  ...(profile.bio ? { description: profile.bio } : {}),
                  ...(channel ? { sameAs: [channel.channelUrl] } : {}),
                },
              },
            ]),
          }}
        />
      )}
      <Page>
        <TopBar back={relation === "self" ? "/me" : "/friends"}>
          {relation !== "self" && viewerId && <ProfileMenu handle={profile.handle} userId={profile.userId} name={profile.displayName} blocked={relation === "blocked"} />}
        </TopBar>
        <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-x-12">
          <section className="grid gap-4 lg:sticky lg:top-24">
            {channel?.bannerUrl && (
              <img src={channel.bannerUrl} alt="" referrerPolicy="no-referrer" className="aspect-[6/1] w-full rounded-2xl object-cover" />
            )}
            <div className="flex items-center gap-4">
              <Avatar name={profile.displayName} seed={profile.userId} src={avatarUrl(profile.avatarKey, profile.handle) ?? channel?.avatarUrl} size={76} />
              <div className="grid min-w-0 gap-0.5">
                <h1 className="line-clamp-2 text-[24px] leading-tight font-black break-words md:text-[28px]">{profile.displayName}</h1>
                <p className="truncate text-sm font-semibold text-muted-foreground">
                  @{profile.handle}
                  {city ? ` · ${city}` : ""}
                </p>
              </div>
            </div>
            {profile.bio && data.canView && <p className="text-[15px] leading-relaxed">{profile.bio}</p>}
            {channel && (
              <a
                href={channel.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-input px-4 text-sm font-extrabold text-foreground"
              >
                YouTube
                {channel.subscriberCount !== null && (
                  <span className="font-semibold text-muted-foreground">· {formatSubscriberCount(channel.subscriberCount)} subscribers</span>
                )}
              </a>
            )}
            <div className="flex gap-5 text-sm">
              <a href={`/u/${profile.handle}?tab=followers`} className="text-foreground">
                <strong className="font-black">{data.followers}</strong> <span className="font-semibold text-muted-foreground">followers</span>
              </a>
              <a href={`/u/${profile.handle}?tab=following`} className="text-foreground">
                <strong className="font-black">{data.following}</strong> <span className="font-semibold text-muted-foreground">following</span>
              </a>
              {data.rank && city && (
                <a href={`/community?city=${profile.homeCitySlug}`} className="text-foreground">
                  <strong className="font-black">#{data.rank}</strong> <span className="font-semibold text-muted-foreground">in {city}</span>
                </a>
              )}
            </div>
            {unclaimed ? (
              <div className="grid gap-1 rounded-2xl bg-muted px-4 py-3">
                <p className="text-[15px] font-extrabold">Unclaimed. Is this you?</p>
                <p className="text-[13px] font-semibold text-subtle-foreground">
                  This profile was made from @{channel.channelHandle}’s public YouTube channel.{" "}
                  <a href={claimHref(profile.handle)} className="font-extrabold text-primary underline-offset-2 hover:underline">
                    Claim it
                  </a>
                </p>
              </div>
            ) : relation === "self" ? (
              <a href="/me/settings" className="inline-flex min-h-11 items-center justify-center rounded-full border border-input text-[15px] font-extrabold text-foreground">
                Edit profile
              </a>
            ) : viewerId ? (
              relation !== "blocked" && <ProfileActions handle={profile.handle} relation={relation} />
            ) : (
              <a href={loginHref(`/u/${profile.handle}`)} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary text-[15px] font-extrabold text-primary-foreground">
                Sign in to follow
              </a>
            )}
          </section>

          {relation === "blocked" ? (
            <p className="py-10 text-center text-sm font-semibold text-muted-foreground">You blocked @{profile.handle}.</p>
          ) : !data.canView ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Icon icon={LockIcon} size={28} />
              <p className="text-[17px] font-extrabold">This account is private</p>
              <p className="text-sm font-semibold text-muted-foreground">Follow to see their checks and lists.</p>
            </div>
          ) : connections ? (
            <section className="grid gap-2 pt-6 lg:pt-0">
              <h2 className="text-[17px] font-black md:text-xl">{tab === "followers" ? "Followers" : "Following"}</h2>
              <ul className="grid md:grid-cols-2 md:gap-x-8">
                {connections.map((person) => (
                  <li key={person.userId}>
                    <a href={`/u/${person.handle}`} className="flex items-center gap-3 border-b border-border/70 py-3 text-foreground">
                      <Avatar name={person.name} seed={person.userId} src={avatarUrl(person.avatarKey, person.handle)} size={40} />
                      <span className="grid min-w-0">
                        <strong className="truncate text-[15px] font-extrabold">{person.name}</strong>
                        <span className="truncate text-[13px] font-semibold text-muted-foreground">@{person.handle}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              {connections.length === 0 && <p className="text-sm font-semibold text-muted-foreground">No one yet.</p>}
            </section>
          ) : (
            <div className="grid gap-7 pt-6 lg:pt-0">
              {verified.length > 0 && (
                <section aria-labelledby="verified-in-videos" className="grid gap-3">
                  <h2 id="verified-in-videos" className="text-[17px] font-black md:text-xl">
                    Verified in videos
                  </h2>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                    {verified.map((item) => (
                      <div key={item.id} className="grid content-start gap-1.5">
                        <a href={`/place/${item.placeId}`} className="grid gap-1.5 text-foreground">
                          <PlaceArt name={item.placeName} seed={item.placeId} className="h-24 w-full" rounded="rounded-[14px]" />
                          <strong className="truncate text-[15px] font-extrabold">{item.placeName}</strong>
                        </a>
                        <span className="truncate text-xs font-bold text-muted-foreground">
                          {[item.addressLocality ?? cityName(item.citySlug), videoMonth(item.videoDate)].filter(Boolean).join(" · ")}
                        </span>
                        <StatusPill status={item.status} short className="w-fit" />
                        <a href={item.videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px] font-extrabold text-primary">
                          Watch{item.timestampSeconds ? ` at ${formatVideoTimestamp(item.timestampSeconds)}` : ""}
                        </a>
                      </div>
                    ))}
                  </div>
                  <p className="text-[13px] font-semibold text-muted-foreground">A video is taste, not a halal check. Each place’s status comes from people who eat there.</p>
                </section>
              )}
              {!(channel && data.stats.checks === 0) && (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    [data.stats.places, "Places"],
                    [data.stats.checks, "Checks"],
                    [data.stats.cities, "Cities"],
                    [data.stats.cuisines, "Cuisines"],
                  ].map(([value, label]) => (
                    <div key={label} className="grid gap-0.5 rounded-2xl bg-muted px-2 py-3 text-center">
                      <strong className="text-xl font-black">{value}</strong>
                      <span className="text-xs font-bold text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.lists.length > 0 && (
                <section className="grid gap-2.5">
                  <h2 className="text-[17px] font-black">Lists</h2>
                  <div className="-mx-5 flex gap-3 overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0">
                    {data.lists.map((list) => (
                      <a key={list.id} href={`/list/${list.id}`} className="grid w-40 shrink-0 content-start gap-1.5 text-foreground md:w-auto">
                        <PlaceArt name={list.coverName ?? list.title} seed={list.coverPlaceId ?? list.id} src={photoUrl(list.coverKey)} className="h-24 w-full" rounded="rounded-[14px]" />
                        <strong className="truncate text-[15px] font-extrabold">{list.title}</strong>
                        <span className="text-xs font-bold text-muted-foreground">
                          {KIND_LABEL[list.kind]} · {list.items}
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
              {!(channel && data.visits.length === 0) && (
                <section className="grid gap-1 md:gap-4">
                  <h2 className="text-[17px] font-black md:text-xl">Recent visits</h2>
                  {data.visits.length ? (
                    data.visits.map((visit) => <VisitCard key={visit.checkId} visit={visitJson(visit)} />)
                  ) : (
                    <p className="py-4 text-sm font-semibold text-muted-foreground">No visits yet.</p>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </Page>
    </AppShell>
  );
}
