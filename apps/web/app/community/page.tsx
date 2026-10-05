import type { Metadata } from "next";
import { citySlugParam } from "@halalfood/core/params";
import { AppShell } from "../../src/components/app-shell";
import { resolveCity } from "../../src/components/explore-screen";
import { Avatar, TopBar } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { leaderboard, type BoardRow } from "../../src/lib/community";
import { cityName } from "../../src/lib/place-view";
import { avatarUrl, getProfile } from "../../src/lib/profiles";
import { CityPicker } from "./city-picker";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const city = citySlugParam(typeof (await searchParams).city === "string" ? ((await searchParams).city as string) : null);
  return {
    title: city ? `Community in ${cityName(city)}` : "Community",
    description: "The people checking halal places in your city, ranked by checks, places added and places they helped verify.",
    alternates: { canonical: city ? `/community?city=${city}` : "/community" },
  };
}

function Row({ row, me }: { row: BoardRow; me: boolean }) {
  return (
    <a
      href={`/u/${row.handle}`}
      className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-foreground ${me ? "bg-accent ring-2 ring-primary/40" : ""}`}
    >
      <span className="w-7 text-center text-[15px] font-black text-muted-foreground">{row.rank}</span>
      <Avatar name={row.name} seed={row.userId} src={avatarUrl(row.avatarKey, row.handle)} size={40} />
      <span className="grid min-w-0 flex-1">
        <strong className="truncate text-[15px] font-extrabold">{me ? "You" : row.name}</strong>
        <span className="truncate text-[13px] font-semibold text-muted-foreground">@{row.handle}</span>
      </span>
      <span className="text-[15px] font-black">{row.points}</span>
    </a>
  );
}

export default async function CommunityPage({ searchParams }: Props) {
  const params = await searchParams;
  const viewerId = await getViewerId();
  const profile = viewerId ? await getProfile(viewerId).catch(() => null) : null;
  const requested = citySlugParam(typeof params.city === "string" ? params.city : null);
  const { city, cities } = await resolveCity(requested ?? profile?.homeCitySlug ?? null);
  const period = params.period === "all" ? "all" : "week";
  const slug = city?.city_slug ?? requested ?? "";
  const board = slug ? await leaderboard(slug, period, viewerId) : { rows: [], me: null };
  const podium = board.rows.slice(0, 3);
  const rest = board.rows.slice(3);
  const me = board.me;
  const meOnBoard = me?.kind === "row" && me.row.rank <= 50;

  return (
    <AppShell active="friends">
      <TopBar back="/friends" title="Community" />
      <div className="grid gap-5 px-5 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <CityPicker value={slug} period={period} cities={cities.slice(0, 300).map((item) => ({ slug: item.city_slug, name: cityName(item.city_slug) }))} />
          <nav aria-label="Period" className="ml-auto grid grid-cols-2 rounded-full bg-secondary p-1">
            {(["week", "all"] as const).map((value) => (
              <a
                key={value}
                href={`/community?city=${slug}&period=${value}`}
                aria-current={period === value ? "page" : undefined}
                className={`min-h-9 rounded-full px-4 text-center text-sm leading-9 font-extrabold ${period === value ? "bg-background text-foreground shadow-sm" : "text-subtle-foreground"}`}
              >
                {value === "week" ? "This week" : "All time"}
              </a>
            ))}
          </nav>
        </div>
        <p className="text-[13px] font-semibold text-muted-foreground">3 points a check, 5 for adding a place, 10 for helping verify one.</p>

        {podium.length ? (
          <div className="grid grid-cols-3 items-end gap-2 text-center">
            {[podium[1], podium[0], podium[2]].map((row, index) =>
              row ? (
                <a key={row.userId} href={`/u/${row.handle}`} className="grid justify-items-center gap-1.5 text-foreground">
                  <Avatar name={row.name} seed={row.userId} src={avatarUrl(row.avatarKey, row.handle)} size={index === 1 ? 72 : 56} ring />
                  <strong className="w-full truncate text-sm font-extrabold">{row.userId === viewerId ? "You" : row.name.split(" ")[0]}</strong>
                  <span
                    className={`flex w-full items-start justify-center rounded-t-2xl pt-2 text-lg font-black ${index === 1 ? "h-24 bg-primary text-primary-foreground" : index === 0 ? "h-16 bg-secondary" : "h-12 bg-secondary"}`}
                  >
                    {row.rank}
                  </span>
                  <span className="text-xs font-bold text-muted-foreground">{row.points} pts</span>
                </a>
              ) : (
                <span key={index} />
              ),
            )}
          </div>
        ) : (
          <p className="py-8 text-center text-sm font-semibold text-muted-foreground">No points here yet. Check a place to get on the board.</p>
        )}

        {rest.length > 0 && (
          <ol className="grid gap-1">
            {rest.map((row) => (
              <li key={row.userId}>
                <Row row={row} me={row.userId === viewerId} />
              </li>
            ))}
          </ol>
        )}

        {me && !meOnBoard && (
          <div className="sticky bottom-[calc(96px+env(safe-area-inset-bottom))] rounded-2xl bg-background shadow-lg md:bottom-4">
            {me.kind === "row" ? (
              <Row row={me.row} me />
            ) : me.kind === "hidden" ? (
              <a href="/me/privacy" className="block rounded-2xl bg-muted px-4 py-3 text-sm font-extrabold text-foreground">
                You’re hidden from leaderboards. <span className="underline">Privacy</span>
              </a>
            ) : (
              <p className="rounded-2xl bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">Check a place in {cityName(slug)} to join the board.</p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
