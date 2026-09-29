"use client";

import { useEffect, useState } from "react";
import { standingLine, type LeaderboardWindow, type Standing } from "@halalfood/core/leaderboard";
import { getClientSession } from "../../src/lib/client-session";

type Loaded = {
  listed: boolean;
  hiddenReason: "private-account" | "opted-out" | "not-onboarded" | null;
  standing: Standing;
};

const HIDDEN: Record<NonNullable<Loaded["hiddenReason"]>, string> = {
  "private-account": "Private accounts aren’t listed on the leaderboard.",
  "opted-out": "You’re hidden from the leaderboard.",
  "not-onboarded": "Finish setting up your profile to join the leaderboard.",
};

/**
 * The signed-in diner's own row, pinned under the board. It reads their
 * standing from the API, so the public rows above stay cacheable.
 */
export default function YourStanding({
  window: period,
  city,
}: {
  window: LeaderboardWindow;
  city: string | null;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!(await getClientSession())) return;
      const params = new URLSearchParams({ window: period });
      if (city) params.set("city", city);
      const response = await fetch(`/api/leaderboard/diners?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { you?: Loaded | null };
      if (body.you) setLoaded(body.you);
    })().catch(() => undefined);
    return () => controller.abort();
  }, [period, city]);

  if (!loaded) return null;
  const { standing, hiddenReason } = loaded;
  return (
    <div
      className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-2xl bg-secondary px-4 py-3.5"
      data-testid="your-standing"
    >
      <span className="min-w-8 text-center font-extrabold">
        {loaded.listed && standing.rank ? `#${standing.rank}` : "You"}
      </span>
      <div className="min-w-0">
        <strong className="block">You</strong>
        <small className="text-[13px] text-muted-foreground">
          {hiddenReason
            ? standing.verified > 0
              ? `${standing.verified} verified · ${HIDDEN[hiddenReason]}`
              : HIDDEN[hiddenReason]
            : standing.verified > 0
              ? standingLine(standing, period)
              : "No verified visits yet. Log a visit with proof of being there to get on the board."}
        </small>
      </div>
    </div>
  );
}
