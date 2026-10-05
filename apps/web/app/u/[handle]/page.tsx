import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LockIcon } from "@hugeicons/core-free-icons";
import { normalizeHandle } from "@halalfood/core/people";
import { AppShell } from "../../../src/components/app-shell";
import { Avatar, Icon, PlaceArt, TopBar } from "../../../src/components/kit";
import { VisitCard } from "../../../src/components/visit-card";
import { getViewerId } from "../../../src/lib/auth-session";
import { KIND_LABEL } from "../../../src/lib/lists";
import { listConnections } from "../../../src/lib/people";
import { cityName, photoUrl } from "../../../src/lib/place-view";
import { avatarUrl } from "../../../src/lib/profiles";
import { loadPublicProfile } from "../../../src/lib/public-profile";
import { loginHref } from "../../../src/lib/signed-out";
import { visitJson } from "../../../src/lib/visit-json";
import { ProfileActions, ProfileMenu } from "./profile-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(raw: string, viewerId: string | null) {
  const handle = normalizeHandle(decodeURIComponent(raw));
  return handle ? loadPublicProfile(handle, viewerId) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).handle, null).catch(() => null);
  if (!data) return { title: "Not found", robots: { index: false } };
  return {
    title: `${data.profile.displayName} (@${data.profile.handle})`,
    description: data.profile.bio ?? `Where ${data.profile.displayName} eats, on halalfood.world.`,
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

  return (
    <AppShell active={relation === "self" ? "you" : "friends"}>
      <TopBar back={relation === "self" ? "/me" : "/friends"}>
        {relation !== "self" && viewerId && <ProfileMenu handle={profile.handle} userId={profile.userId} name={profile.displayName} blocked={relation === "blocked"} />}
      </TopBar>
      <section className="grid gap-4 px-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} seed={profile.userId} src={avatarUrl(profile.avatarKey, profile.handle)} size={76} />
          <div className="grid min-w-0 gap-0.5">
            <h1 className="truncate text-[24px] leading-tight font-black">{profile.displayName}</h1>
            <p className="truncate text-sm font-semibold text-muted-foreground">
              @{profile.handle}
              {city ? ` · ${city}` : ""}
            </p>
          </div>
        </div>
        {profile.bio && data.canView && <p className="text-[15px] leading-relaxed">{profile.bio}</p>}
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
        {relation === "self" ? (
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
        <p className="px-5 py-10 text-center text-sm font-semibold text-muted-foreground">You blocked @{profile.handle}.</p>
      ) : !data.canView ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <Icon icon={LockIcon} size={28} />
          <p className="text-[17px] font-extrabold">This account is private</p>
          <p className="text-sm font-semibold text-muted-foreground">Follow to see their checks and lists.</p>
        </div>
      ) : connections ? (
        <section className="grid gap-2 px-5 pt-6 pb-10">
          <h2 className="text-[17px] font-black">{tab === "followers" ? "Followers" : "Following"}</h2>
          <ul className="grid">
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
        <div className="grid gap-7 px-5 pt-6 pb-10">
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
          {data.lists.length > 0 && (
            <section className="grid gap-2.5">
              <h2 className="text-[17px] font-black">Lists</h2>
              <div className="flex gap-3 overflow-x-auto [scrollbar-width:none]">
                {data.lists.map((list) => (
                  <a key={list.id} href={`/list/${list.id}`} className="grid w-40 shrink-0 gap-1.5 text-foreground">
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
          <section className="grid gap-1">
            <h2 className="text-[17px] font-black">Recent visits</h2>
            {data.visits.length ? (
              data.visits.map((visit) => <VisitCard key={visit.checkId} visit={visitJson(visit)} />)
            ) : (
              <p className="py-4 text-sm font-semibold text-muted-foreground">No visits yet.</p>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
