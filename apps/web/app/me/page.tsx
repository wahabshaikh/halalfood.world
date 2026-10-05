import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight01Icon, Settings02Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { VERDICT_LABEL } from "@halalfood/core/check";
import { AppShell } from "../../src/components/app-shell";
import { Avatar, Icon, IconLink, Page, PlaceArt } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { listMyChecks } from "../../src/lib/checks-repository";
import { KIND_LABEL, listsOwnedBy } from "../../src/lib/lists";
import { isModerator, openReportCount } from "../../src/lib/moderators";
import { loadPassport } from "../../src/lib/passport";
import { cityName, photoUrl } from "../../src/lib/place-view";
import { avatarUrl, cityRank, ensureProfile, profileStats } from "../../src/lib/profiles";
import { loginHref } from "../../src/lib/signed-out";
import { InviteButton, MeTabs } from "./me-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "You", robots: { index: false } };

function day(at: number) {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function MePage() {
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref("/me"));
  const profile = await ensureProfile(viewerId);
  if (!profile) redirect("/");
  const stats = await profileStats(viewerId);
  const [rank, passport, checks, lists, moderator] = await Promise.all([
    profile.homeCitySlug ? cityRank(viewerId, profile.homeCitySlug).catch(() => null) : Promise.resolve(null),
    loadPassport(viewerId, stats.helpedVerify),
    listMyChecks(viewerId, 100),
    listsOwnedBy(viewerId, viewerId),
    isModerator(viewerId),
  ]);
  const openReports = moderator ? await openReportCount().catch(() => 0) : 0;
  const city = profile.homeCitySlug ? cityName(profile.homeCitySlug) : null;

  return (
    <AppShell active="you">
      <Page className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-x-12">
        <div className="grid gap-2 lg:sticky lg:top-24">
          <header className="-mx-3 flex items-center justify-between">
            <InviteButton handle={profile.handle} />
            <IconLink href="/me/settings" label="Settings" icon={Settings02Icon} />
          </header>

          <section className="grid gap-4">
            <div className="flex items-center gap-4">
              <Avatar name={profile.displayName} seed={viewerId} src={avatarUrl(profile.avatarKey, profile.handle)} size={76} />
              <div className="grid min-w-0 gap-0.5">
                <h1 className="line-clamp-2 text-[24px] leading-tight font-black break-words md:text-[28px]">{profile.displayName}</h1>
                <p className="truncate text-sm font-semibold text-muted-foreground">
                  @{profile.handle}
                  {city ? ` · ${city}` : ""}
                </p>
            </div>
          </div>
          {!profile.onboarded && (
            <a href="/welcome?returnTo=/me" className="flex items-center justify-between rounded-2xl bg-accent px-4 py-3 text-sm font-extrabold text-foreground">
              Finish setting up your profile
              <Icon icon={ArrowRight01Icon} size={18} />
            </a>
          )}
          <div className="flex gap-5 text-sm font-semibold text-muted-foreground">
            <a href={`/u/${profile.handle}?tab=followers`} className="text-foreground">
              <strong className="font-black">{stats.followers}</strong> <span className="text-muted-foreground">followers</span>
            </a>
            <a href={`/u/${profile.handle}?tab=following`} className="text-foreground">
              <strong className="font-black">{stats.following}</strong> <span className="text-muted-foreground">following</span>
            </a>
            {rank && city && (
              <a href={`/community?city=${profile.homeCitySlug}`} className="text-foreground">
                <strong className="font-black">#{rank}</strong> <span className="text-muted-foreground">in {city}</span>
              </a>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              [stats.checks, "Checks"],
              [stats.placesAdded, "Places added"],
              [stats.helpedVerify, "Helped verify"],
            ].map(([value, label]) => (
              <div key={label} className="grid gap-0.5 rounded-2xl bg-muted px-3 py-3">
                <strong className="text-[22px] font-black">{value}</strong>
                <span className="text-xs font-bold text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          {moderator && (
            <a href="/admin" className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3 text-foreground">
              <Icon icon={Shield01Icon} />
              <span className="flex-1 text-[15px] font-extrabold">Moderation</span>
              {openReports > 0 && <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-black text-white">{openReports}</span>}
              <Icon icon={ArrowRight01Icon} size={18} />
            </a>
          )}
        </section>
        </div>

        <MeTabs
          passport={
            <div className="grid gap-5">
              <PinPlot pins={passport.pins} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [passport.passport.cities, "Cities"],
                  [passport.passport.cuisines, "Cuisines"],
                  [passport.passport.countries, "Countries"],
                  [passport.passport.wentBack, "Went back"],
                ].map(([value, label]) => (
                  <div key={label} className="grid gap-0.5 rounded-2xl border border-border px-3 py-3">
                    <strong className="text-xl font-black">{value}</strong>
                    <span className="text-xs font-bold text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
              <div className="grid gap-2">
                <h2 className="text-[17px] font-black">Milestones</h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {passport.milestones.map((milestone) => (
                    <li key={milestone.key} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${milestone.achieved ? "bg-success-muted" : "bg-muted"}`}>
                      <span className="grid flex-1 gap-0.5">
                        <strong className="text-[15px] font-extrabold">{milestone.label}</strong>
                        <span className="text-[13px] font-semibold text-muted-foreground">{milestone.description}</span>
                      </span>
                      <span className={`text-sm font-black ${milestone.achieved ? "text-success" : "text-muted-foreground"}`}>
                        {milestone.achieved ? "✓" : `${milestone.progress}/${milestone.target}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          }
          checks={
            checks.length ? (
              <ul className="grid">
                {checks.map((check) => {
                  const needs = check.status.kind === "verified" ? 0 : check.status.kind === "checking" ? 3 - check.status.progress : 3;
                  return (
                    <li key={check.id} className="border-b border-border/70 last:border-b-0">
                      <a href={`/place/${check.placeId}`} className="flex items-center gap-3 py-3 text-foreground">
                        <PlaceArt name={check.placeName} seed={check.placeId} className="size-12" rounded="rounded-[12px]" textSize="text-sm" />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <strong className="truncate text-[15px] font-extrabold">{check.placeName}</strong>
                          <span className="truncate text-[13px] font-semibold text-muted-foreground">
                            {day(check.createdAt)}
                            {check.verdict ? ` · ${VERDICT_LABEL[check.verdict]}` : ""}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${needs === 0 ? "bg-success-muted text-success" : "bg-warning-muted text-warning-strong"}`}
                        >
                          {needs === 0 ? "✓ Verified" : `Needs ${needs} more`}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm font-semibold text-muted-foreground">
                Your checks show up here. <a href="/" className="font-extrabold text-foreground underline">Find a place</a>
              </p>
            )
          }
          lists={
            lists.length ? (
              <ul className="grid gap-2 md:grid-cols-2 md:gap-3">
                {lists.map((list) => (
                  <li key={list.id}>
                    <a href={`/list/${list.id}`} className="flex items-center gap-3 rounded-2xl border border-border p-3 text-foreground">
                      <PlaceArt name={list.coverName ?? list.title} seed={list.coverPlaceId ?? list.id} src={photoUrl(list.coverKey)} className="size-14" rounded="rounded-[12px]" />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <strong className="truncate text-[15px] font-extrabold">{list.title}</strong>
                        <span className="text-[13px] font-semibold text-muted-foreground">
                          {KIND_LABEL[list.kind]} · {list.items} {list.items === 1 ? "place" : "places"}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm font-semibold text-muted-foreground">
                No lists yet. <a href="/saved?tab=lists" className="font-extrabold text-foreground underline">Make one</a>
              </p>
            )
          }
        />
      </Page>
    </AppShell>
  );
}

/** A tiny dot map of every place checked: no tiles, just relative positions. */
function PinPlot({ pins }: { pins: { placeId: string; lat: number; lng: number }[] }) {
  if (!pins.length)
    return <div className="flex h-40 items-center justify-center rounded-[20px] bg-map text-sm font-semibold text-muted-foreground">Places you check appear here.</div>;
  const lats = pins.map((pin) => pin.lat);
  const lngs = pins.map((pin) => pin.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const spanLat = Math.max(maxLat - minLat, 0.02);
  const spanLng = Math.max(maxLng - minLng, 0.02);
  return (
    <a href="/map" className="block overflow-hidden rounded-[20px] bg-map" aria-label={`Map of ${pins.length} places you checked`}>
      <svg viewBox="0 0 100 50" className="h-40 w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {pins.map((pin) => {
          const x = 8 + ((pin.lng - (minLng + maxLng) / 2) / spanLng) * 84 + 42;
          const y = 4 + (((minLat + maxLat) / 2 - pin.lat) / spanLat) * 42 + 21;
          return <circle key={pin.placeId} cx={x} cy={y} r={1.6} className="fill-primary stroke-background" strokeWidth={0.5} />;
        })}
      </svg>
    </a>
  );
}
