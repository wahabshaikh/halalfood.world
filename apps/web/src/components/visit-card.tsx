"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BubbleChatIcon, FavouriteIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { cn } from "@halalfood/ui/lib/utils";
import { STATUS_COPY } from "@halalfood/core/halal-taxonomy";
import { DISH_VERDICT_COPY, VERDICT_COPY } from "@halalfood/core/check-in";
import { describeHalalCheck, relativeTime } from "@halalfood/core/feed";
import type { FeedCard } from "../lib/feed-repository";
import { cityName } from "../lib/seo";
import { InitialsAvatar, monogram } from "./blocks";
import { TONE_BADGE } from "./status-tone";
import { CommunityChain } from "./community-chain";

const VERDICT_TEXT: Record<NonNullable<FeedCard["verdict"]>, string> = {
  disliked: "text-destructive",
  okay: "text-warning-foreground",
  liked: "text-success",
  favourite: "text-primary",
};

/** Send a signed-out visitor to sign in, then bring them back here. */
export function goToLogin(reason = "join") {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?reason=${reason}&returnTo=${encodeURIComponent(here)}`);
}

export function authorName(author: FeedCard["author"]): string {
  if (author.isYou) return "You";
  return author.displayName ?? author.handle ?? "A diner";
}

/**
 * One shared visit: who, where, how it was, what they ordered and any halal
 * check they made. The halal check is labelled as the diner's own observation
 * and the place's status badge comes only from approved evidence, so a popular
 * visit can never make a place look more halal.
 */
export function VisitCard({
  card,
  detail = false,
}: {
  card: FeedCard;
  /** On the visit page the whole card is not a link to itself. */
  detail?: boolean;
}) {
  const [liked, setLiked] = useState(card.liked);
  const [likes, setLikes] = useState(card.likes);
  const [busy, setBusy] = useState(false);

  const name = authorName(card.author);
  const tone = STATUS_COPY[card.place.status].tone;
  const observation = card.halalCheck ? describeHalalCheck(card.halalCheck) : [];

  async function toggleLike() {
    if (busy) return;
    const next = !liked;
    setBusy(true);
    setLiked(next);
    setLikes((count) => Math.max(0, count + (next ? 1 : -1)));
    try {
      const response = await fetch(`/api/visits/${card.visitId}/like`, {
        method: next ? "PUT" : "DELETE",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        setLiked(!next);
        setLikes((count) => Math.max(0, count + (next ? -1 : 1)));
        goToLogin("like");
        return;
      }
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { likes?: number };
      if (typeof payload.likes === "number") setLikes(payload.likes);
    } catch {
      setLiked(!next);
      setLikes((count) => Math.max(0, count + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3.5 px-5 py-5" data-testid="visit-card">
      <header className="flex items-center gap-3">
        <InitialsAvatar initials={monogram(name)} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">
            {card.author.handle ? (
              <a href={`/u/${card.author.handle}`} className="hover:underline">
                {name}
              </a>
            ) : (
              name
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {card.verdict && (
              <span className={cn("font-bold", VERDICT_TEXT[card.verdict])}>
                {VERDICT_COPY[card.verdict]}
              </span>
            )}
            {card.verdict && " · "}
            {detail ? (
              <time dateTime={new Date(card.visitedAt).toISOString()}>
                {new Date(card.visitedAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </time>
            ) : (
              <a href={`/visit/${card.visitId}`} className="hover:underline">
                {relativeTime(card.createdAt)}
              </a>
            )}
          </p>
        </div>
      </header>

      <div className="grid gap-1">
        <a
          href={`/place/${encodeURIComponent(card.place.id)}`}
          className="text-xl leading-tight font-extrabold hover:underline"
        >
          {card.place.name}
        </a>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{cityName(card.place.citySlug)}</span>
          {card.place.status !== "unverified" && (
            <Badge variant={TONE_BADGE[tone]}>{STATUS_COPY[card.place.status].label}</Badge>
          )}
          {card.verified && <Badge variant="muted">Location verified</Badge>}
          {card.disclosureLabel && <Badge variant="warning">{card.disclosureLabel}</Badge>}
        </p>
      </div>

      {card.note && <p className="whitespace-pre-line">{card.note}</p>}

      {card.dishes.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="What they ordered">
          {card.dishes.map((dish) => (
            <li key={dish.name}>
              <Badge variant={dish.verdict === "avoid" ? "destructive" : "secondary"}>
                {dish.name}
                {dish.verdict !== "fine" && ` · ${DISH_VERDICT_COPY[dish.verdict]}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {card.halalCheck && observation.length > 0 && (
        <div className="grid gap-1 rounded-xl bg-secondary px-3.5 py-3 text-sm">
          <p className="font-bold">
            {card.author.isYou ? "Your" : `${name}’s`} halal check
            <span className="font-normal text-muted-foreground">
              {" "}
              · what {card.author.isYou ? "you" : "they"} noticed
            </span>
          </p>
          <ul className="list-disc pl-5">
            {observation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">
            {card.halalCheck.status === "approved"
              ? "Approved by a moderator."
              : "Waiting for a moderator. It does not change the place’s status until it is approved."}
          </p>
          {card.halalCheck.id && (
            <CommunityChain
              targetType="verification"
              targetId={card.halalCheck.id}
              own={card.author.isYou || card.halalCheck.status !== "approved"}
              confirmCount={card.halalCheck.confirmCount}
              reportCount={card.halalCheck.reportCount}
              viewerConfirmed={card.halalCheck.viewerConfirmed}
              reportLabel="Report this check"
            />
          )}
        </div>
      )}

      <footer className="flex items-center gap-1 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 rounded-full font-bold", liked && "text-primary")}
          aria-pressed={liked}
          aria-label={liked ? "Remove your like" : "Like this visit"}
          disabled={busy}
          onClick={toggleLike}
        >
          <HugeiconsIcon
            icon={FavouriteIcon}
            size={20}
            strokeWidth={liked ? 0 : 2}
            fill={liked ? "currentColor" : "none"}
            aria-hidden="true"
          />
          {likes}
        </Button>
        <Button asChild variant="ghost" size="sm" className="gap-1.5 rounded-full font-bold">
          <a href={`/visit/${card.visitId}`} aria-label={`${card.comments} comments`}>
            <HugeiconsIcon icon={BubbleChatIcon} size={20} aria-hidden="true" />
            {card.comments}
          </a>
        </Button>
      </footer>
    </Card>
  );
}
