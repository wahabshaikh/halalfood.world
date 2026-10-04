"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import type { FeedCard } from "../../src/lib/feed-repository";
import { Loading } from "../../src/components/blocks";
import { EmptyPanel } from "../../src/components/site-chrome";
import { presentFetchFailure, presentTransportFailure, type PresentedFailure } from "../../src/lib/failure-copy";
import { signedOutLoginPath } from "../../src/lib/signed-out";
import { FormMessage, Note } from "../../src/components/section";
import { VisitCard } from "../../src/components/visit-card";

type State = "loading" | "ready" | "unauthenticated" | "error";

export default function FeedView() {
  const [state, setState] = useState<State>("loading");
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hidden, setHidden] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<PresentedFailure | null>(null);
  const [moreError, setMoreError] = useState<PresentedFailure | null>(null);

  const load = useCallback(async (after: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (after) params.set("cursor", after);
    try {
      const response = await fetch(`/api/feed?${params}`, {
        signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 401) return "unauthenticated" as const;
      if (!response.ok) return { ok: false as const, failure: await presentFetchFailure("your feed", response, null) };
      const body = (await response.json()) as {
        cards?: FeedCard[];
        nextCursor?: string | null;
        hiddenByStandard?: number;
      };
      return { ok: true as const, ...body };
    } catch (caught) {
      if ((caught as Error).name === "AbortError") throw caught;
      return { ok: false as const, failure: presentTransportFailure("your feed", caught) };
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(null, controller.signal)
      .then((payload) => {
        if (payload === "unauthenticated") {
          setState("unauthenticated");
          return;
        }
        if (!payload.ok) {
          setError(payload.failure);
          setState("error");
          return;
        }
        setCards(Array.isArray(payload.cards) ? payload.cards : []);
        setCursor(payload.nextCursor ?? null);
        setHidden(payload.hiddenByStandard ?? 0);
        setState("ready");
      })
      .catch((caught) => {
        if ((caught as Error).name !== "AbortError") {
          setError(presentTransportFailure("your feed", caught));
          setState("error");
        }
      });
    return () => controller.abort();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    setMoreError(null);
    try {
      const payload = await load(cursor);
      if (payload === "unauthenticated") {
        window.location.assign(signedOutLoginPath("/feed"));
        return;
      }
      if (!payload.ok) {
        setMoreError(payload.failure);
        return;
      }
      setCards((current) => {
        const seen = new Set(current.map((card) => card.visitId));
        return [...current, ...(payload.cards ?? []).filter((card) => !seen.has(card.visitId))];
      });
      setCursor(payload.nextCursor ?? null);
      setHidden((count) => count + (payload.hiddenByStandard ?? 0));
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setMoreError(presentTransportFailure("your feed", caught));
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

  if (state === "error") {
    return (
      <FormMessage tone="error">
        {error?.message}{" "}
        {error?.retry && (
          <button type="button" className="font-bold underline" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </FormMessage>
    );
  }

  return (
    <div className="grid gap-4">
      {cards.length > 0 && (
        <div className="flex justify-end">
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

      {moreError && (
        <FormMessage tone="error">
          {moreError.message}{" "}
          {moreError.retry && (
            <button type="button" className="font-bold underline" onClick={() => void loadMore()}>
              Try again
            </button>
          )}
        </FormMessage>
      )}
      {cursor && (
        <Button variant="outline" size="lg" disabled={more} onClick={loadMore}>
          {more ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}
