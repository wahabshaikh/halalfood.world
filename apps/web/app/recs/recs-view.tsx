"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { cn } from "@halalfood/ui/lib/utils";
import { REC_REPLIES, REC_REPLY_LABELS, type RecReply } from "@halalfood/core/recs";
import { relativeTime } from "@halalfood/core/feed";
import { STATUS_COPY } from "@halalfood/core/halal-taxonomy";
import type { RecCard } from "../../src/lib/recs-repository";
import { InitialsAvatar, Loading, monogram } from "../../src/components/blocks";
import { EmptyPanel } from "../../src/components/site-chrome";
import { FormMessage } from "../../src/components/section";
import { TONE_BADGE } from "../../src/components/status-tone";
import { goToLogin } from "../../src/components/visit-card";
import { cityName } from "../../src/lib/seo";

type Box = "inbox" | "sent";
type State = "loading" | "ready" | "unauthenticated" | "error";

const SENT_REPLY: Record<RecReply, string> = {
  in: "is in",
  "want-to-try": "wants to try it",
};

export default function RecsView({ initialBox }: { initialBox: Box }) {
  const [box, setBox] = useState<Box>(initialBox);
  const [state, setState] = useState<State>("loading");
  const [cards, setCards] = useState<RecCard[]>([]);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (next: Box, signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch(`/api/recs?box=${next}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) return setState("unauthenticated");
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { cards?: RecCard[]; hiddenByStandard?: number };
      setCards(Array.isArray(body.cards) ? body.cards : []);
      setHidden(body.hiddenByStandard ?? 0);
      setState("ready");
      if (next === "inbox")
        void fetch("/api/recs/read", { method: "POST" }).catch(() => undefined);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(box, controller.signal);
    return () => controller.abort();
  }, [box, load]);

  async function reply(card: RecCard, answer: RecReply) {
    setBusy(card.id);
    setError("");
    try {
      const response = await fetch(`/api/recs/${card.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: answer }),
      });
      if (!response.ok) throw new Error();
      setCards((current) => current.map((entry) => (entry.id === card.id ? { ...entry, reply: answer } : entry)));
    } catch {
      setError("That didn’t go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (state === "unauthenticated")
    return (
      <EmptyPanel
        art="visits"
        title="Sign in to see your recs"
        description="Friends can send you a place or a list with a note. It lands here, with no chat to keep up with."
      >
        <Button size="xl" onClick={() => goToLogin("recs")}>
          Log in or sign up
        </Button>
      </EmptyPanel>
    );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Recs">
        {(["inbox", "sent"] as const).map((key) => (
          <Button
            key={key}
            role="tab"
            aria-selected={box === key}
            variant="outline"
            className={cn("h-9 rounded-full px-4 font-bold", box === key && "border-2 border-foreground bg-secondary")}
            onClick={() => setBox(key)}
          >
            {key === "inbox" ? "Inbox" : "Sent"}
          </Button>
        ))}
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {state === "loading" && <Loading>Loading your recs…</Loading>}
      {state === "error" && (
        <FormMessage tone="error">
          Could not load your recs.{" "}
          <button className="underline" onClick={() => void load(box)}>
            Try again
          </button>
        </FormMessage>
      )}

      {state === "ready" && !cards.length && (
        <EmptyPanel
          art="visits"
          titleAs="h2"
          title={box === "inbox" ? "No recs yet" : "You haven’t sent any recs"}
          description={
            box === "inbox"
              ? "When a friend sends you a place or a list, it shows up here. You can answer with one tap."
              : "Open a place or a list and choose Send to recommend it to friends."
          }
        >
          <Button asChild size="xl" variant="outline">
            <a href="/leaderboard">Find people to follow</a>
          </Button>
        </EmptyPanel>
      )}

      {state === "ready" &&
        cards.map((card) => {
          const name = card.person.displayName ?? `@${card.person.handle}`;
          const target = card.target;
          return (
            <Card key={card.id} className="gap-3 px-5 py-5" data-testid="rec-card">
              <header className="flex items-center gap-3">
                <InitialsAvatar initials={monogram(name)} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    <a href={`/u/${card.person.handle}`} className="hover:underline">
                      {name}
                    </a>
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {box === "inbox"
                      ? target.kind === "list"
                        ? "sent a list"
                        : "sent a place"
                      : `you sent this to ${name}`}{" "}
                    · {relativeTime(card.createdAt)}
                  </p>
                </div>
                {card.unread && <span className="size-2 rounded-full bg-primary" role="img" aria-label="New" />}
              </header>

              {card.note && <p className="text-[15px]">&ldquo;{card.note}&rdquo;</p>}

              <a
                href={target.kind === "place" ? `/place/${target.id}` : `/list/${target.id}`}
                className="grid gap-1 rounded-xl bg-secondary p-4 hover:bg-secondary/70"
              >
                {target.kind === "place" ? (
                  <>
                    <strong>{target.name}</strong>
                    <span className="text-[13px] text-muted-foreground">
                      {cityName(target.citySlug)}
                      {target.address ? ` · ${target.address}` : ""}
                    </span>
                    <Badge variant={TONE_BADGE[STATUS_COPY[target.status].tone]} className="mt-1 w-fit">
                      {target.statusLabel}
                    </Badge>
                  </>
                ) : (
                  <>
                    <strong>{target.title}</strong>
                    <span className="text-[13px] text-muted-foreground">
                      {target.places} {target.places === 1 ? "place" : "places"}
                      {target.ownerHandle ? ` · by @${target.ownerHandle}` : ""}
                    </span>
                  </>
                )}
              </a>

              {box === "inbox" ? (
                <div className="flex flex-wrap gap-2">
                  {REC_REPLIES.map((answer) => (
                    <Button
                      key={answer}
                      size="sm"
                      variant={card.reply === answer ? "default" : "outline"}
                      disabled={busy === card.id}
                      aria-pressed={card.reply === answer}
                      onClick={() => void reply(card, answer)}
                    >
                      {REC_REPLY_LABELS[answer]}
                    </Button>
                  ))}
                </div>
              ) : (
                card.reply && (
                  <p className="text-sm font-bold text-success">
                    {name} {SENT_REPLY[card.reply]}
                  </p>
                )
              )}
            </Card>
          );
        })}

      {state === "ready" && hidden > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {hidden} {hidden === 1 ? "rec is" : "recs are"} hidden because {hidden === 1 ? "the place doesn’t" : "the places don’t"}{" "}
          meet your halal standard. <a href="/preferences" className="underline">Change your standard</a>
        </p>
      )}
    </div>
  );
}
