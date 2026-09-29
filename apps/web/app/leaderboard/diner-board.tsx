import {
  LEADERBOARD_RULES,
  LEADERBOARD_WINDOWS,
  LEADERBOARD_WINDOW_LABELS,
  verifiedLabel,
  type LeaderboardWindow,
  type RankedDiner,
} from "@halalfood/core/leaderboard";
import { avatarUrl } from "@halalfood/core/social";
import { ChipLink, ChipRow, EmptyState } from "../../src/components/blocks";
import { PersonAvatar } from "../../src/components/person";
import { Note } from "../../src/components/section";
import { SectionTitle } from "../../src/components/place-tile";
import { cityName } from "../../src/lib/seo";
import YourStanding from "./your-standing";

function href(window: LeaderboardWindow, city: string | null) {
  const params = new URLSearchParams();
  if (window !== "week") params.set("window", window);
  if (city) params.set("city", city);
  const query = params.toString();
  return `/leaderboard${query ? `?${query}` : ""}`;
}

/**
 * Diners ranked by verified visits, this week or all time, for one city or
 * everywhere. The rows are the same for every visitor, so they render on the
 * server; a signed-in diner's own row is added by the client component below.
 */
export function DinerBoard({
  ranked,
  window,
  city,
  cityChoices,
}: {
  ranked: RankedDiner[];
  window: LeaderboardWindow;
  city: string | null;
  cityChoices: string[];
}) {
  return (
    <section aria-labelledby="diners-title" className="mb-10">
      <SectionTitle id="diners-title" className="mb-1">
        Leaderboard
      </SectionTitle>
      <Note className="mb-4">Ranked by verified visits</Note>

      <ChipRow className="mb-3" role="navigation" aria-label="Leaderboard period">
        {LEADERBOARD_WINDOWS.map((key) => (
          <ChipLink key={key} href={href(key, city)} active={window === key}>
            {LEADERBOARD_WINDOW_LABELS[key]}
          </ChipLink>
        ))}
      </ChipRow>
      <ChipRow className="mb-5" role="navigation" aria-label="Leaderboard place">
        <ChipLink href={href(window, null)} active={!city}>
          Global
        </ChipLink>
        {cityChoices.map((slug) => (
          <ChipLink key={slug} href={href(window, slug)} active={city === slug}>
            {cityName(slug)}
          </ChipLink>
        ))}
      </ChipRow>

      {ranked.length === 0 ? (
        <EmptyState>
          Nobody has a verified visit {window === "week" ? "this week" : "here"} yet.{" "}
          <a href="/log">Log one</a> to be first.
        </EmptyState>
      ) : (
        <ol className="divide-y" data-testid="diner-board">
          {ranked.map((diner) => {
            const name = diner.displayName ?? `@${diner.handle}`;
            return (
              <li
                key={diner.handle}
                className="grid grid-cols-[32px_auto_minmax(0,1fr)_auto] items-center gap-3.5 py-3.5"
              >
                <span className="text-center font-extrabold">{diner.rank}</span>
                <PersonAvatar name={name} avatarUrl={avatarUrl(diner.handle, diner.avatarKey)} size={44} />
                <div className="min-w-0">
                  <a href={`/u/${diner.handle}`} className="block truncate text-[15px] font-bold hover:underline">
                    @{diner.handle}
                  </a>
                  <small className="text-[13px] text-muted-foreground">{verifiedLabel(diner.verified, window)}</small>
                </div>
                <span className="text-right font-extrabold">{diner.verified}</span>
              </li>
            );
          })}
        </ol>
      )}

      <YourStanding window={window} city={city} />
      <Note className="mt-4">{LEADERBOARD_RULES}</Note>
    </section>
  );
}
