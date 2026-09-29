"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import type { FeedCard } from "../../src/lib/feed-repository";
import { Loading } from "../../src/components/blocks";
import { EmptyPanel } from "../../src/components/site-chrome";
import { FormMessage, Note } from "../../src/components/section";
import { VisitCard } from "../../src/components/visit-card";

type Streak = { current: number; line: string; atRisk: boolean };
type State = "loading" | "ready" | "unauthenticated" | "error";

function utcOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

export default function FeedView() {
  const [state, setState] = useState<State>("loading");
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [hidden, setHidden] = useState(0);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const load = useCallback(async (after: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ utcOffsetMinutes: String(utcOffsetMinutes()) });
    if (after) params.set("cursor", after);
    const response = await fetch(`/api/feed?${params}`, {
      signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.status === 401) return "unauthenticated" as const;
    if (!response.ok) throw new Error("feed");
    return (await response.json()) as {
      cards?: FeedCard[];
      nextCursor?: string | null;
      streak?: Streak | null;
      hiddenByStandard?: number;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(null, controller.signal)
      .then((payload) => {
        if (payload === "unauthenticated") {
          setState("unauthenticated");
          return;
        }
        setCards(Array.isArray(payload.cards) ? payload.cards : []);
        setCursor(payload.nextCursor ?? null);
        setStreak(payload.streak ?? null);
        setHidden(payload.hiddenByStandard ?? 0);
        setState("ready");
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    setMoreError(false);
    try {
      const payload = await load(cursor);
      if (payload === "unauthenticated") {
        setState("unauthenticated");
        return;
      }
      setCards((current) => {
        const seen = new Set(current.map((card) => card.visitId));
        return [...current, ...(payload.cards ?? []).filter((card) => !seen.has(card.visitId))];
      });
      setCursor(payload.nextCursor ?? null);
      setHidden((count) => count + (payload.hiddenByStandard ?? 0));
    } catch {
      setMoreError(true);
    } finally {
      setMore(false);
    }
  }

  if (state === "loading") return <Loading>Loading your friends&rsquo; visits…</Loading>;

  if (state === "unauthenticated")
    return (
      <EmptyPanel
        art="visits"
        title="See where your friends eat"
        description="Sign in to follow people you trust and see the halal places they have been to, with what they ordered and what they noticed."
      >
        <Button asChild size="xl">
          <a href="/login?reason=join&returnTo=%2Ffeed">Log in or sign up</a>
        </Button>
        <Button asChild size="xl" variant="outline">
          <a href="/">Explore places</a>
        </Button>
      </EmptyPanel>
    );

  if (state === "error")
    return (
      <FormMessage tone="error">
        Your feed could not load. Please refresh and try again.
      </FormMessage>
    );

  return (
    <div className="grid gap-4">
      {streak && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary px-5 py-4">
          <p className="text-sm font-semibold">{streak.line}</p>
          <Button asChild size="sm">
            <a href="/log">Log a visit</a>
          </Button>
        </div>
      )}

      {cards.length === 0 ? (
        <EmptyPanel
          art="visits"
          titleAs="h2"
          title="Nothing here yet"
          description="Visits from you and the people you follow appear here. Log a place you ate at, or find diners to follow from the community."
        >
          <Button asChild size="xl">
            <a href="/log">Log a visit</a>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href="/leaderboard">Find people to follow</a>
          </Button>
        </EmptyPanel>
      ) : (
        cards.map((card) => <VisitCard key={card.visitId} card={card} />)
      )}

      {hidden > 0 && (
        <Note>
          {hidden === 1 ? "1 visit is" : `${hidden} visits are`} hidden because{" "}
          {hidden === 1 ? "the place doesn’t" : "the places don’t"} meet your halal
          standard. You can change it in your{" "}
          <a className="underline" href="/preferences">
            dietary standards
          </a>
          .
        </Note>
      )}

      {moreError && <FormMessage tone="error">Could not load more. Please try again.</FormMessage>}
      {cursor && (
        <Button variant="outline" size="lg" disabled={more} onClick={loadMore}>
          {more ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}
