"use client";

import { useState } from "react";
import { BubbleChatIcon, FavouriteIcon } from "@hugeicons/core-free-icons";
import type { PlaceStatus } from "@halalfood/core/halal";
import type { Verdict } from "@halalfood/core/check";
import { cn } from "@halalfood/ui/lib/utils";
import { Avatar, Icon, StatusPill } from "./kit";
import { SaveHeart, api, errorText, toast } from "./kit-client";
import { timeAgo } from "./time-ago";

export type VisitJson = {
  checkId: string;
  author: { userId: string; handle: string | null; name: string; avatarUrl: string | null };
  place: { id: string; name: string; area: string; status: PlaceStatus };
  verdict: Verdict | null;
  note: string | null;
  dishes: string[];
  photos: (string | null)[];
  createdAt: number;
  likes: number;
  comments: number;
  likedByMe: boolean;
  savedByMe: boolean;
};

export function verbFor(verdict: Verdict | null): string {
  return verdict === "loved" ? "loved" : verdict === "liked" ? "liked" : "checked";
}

export function LikeButton({ checkId, initial, count, className }: { checkId: string; initial: boolean; count: number; className?: string }) {
  const [liked, setLiked] = useState(initial);
  const [likes, setLikes] = useState(count);
  const toggle = async () => {
    const next = !liked;
    setLiked(next);
    setLikes((value) => value + (next ? 1 : -1));
    try {
      const result = await api<{ likes: number }>(`/api/checks/${checkId}/like`, { method: next ? "PUT" : "DELETE" });
      setLikes(result.likes);
    } catch (error) {
      setLiked(!next);
      setLikes((value) => value + (next ? -1 : 1));
      toast(errorText(error));
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-sm font-extrabold", liked ? "text-primary" : "text-foreground", className)}
    >
      <Icon icon={FavouriteIcon} size={20} className={liked ? "[&_path]:fill-current" : undefined} />
      {likes > 0 && likes}
    </button>
  );
}

export function VisitCard({ visit }: { visit: VisitJson }) {
  const photo = visit.photos.find(Boolean) ?? null;
  return (
    <article className="grid gap-3 border-b border-border/70 py-4 last:border-b-0">
      <header className="flex items-start gap-3">
        <a href={visit.author.handle ? `/u/${visit.author.handle}` : "#"} aria-label={visit.author.name}>
          <Avatar name={visit.author.name} seed={visit.author.userId} src={visit.author.avatarUrl} size={40} />
        </a>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-[15px] leading-snug">
            <strong className="font-black">{visit.author.name}</strong> {verbFor(visit.verdict)}{" "}
            <a href={`/place/${visit.place.id}`} className="font-black text-foreground">
              {visit.place.name}
            </a>
          </p>
          <span className="text-[13px] font-semibold text-muted-foreground">
            {timeAgo(visit.createdAt)}
            {visit.place.area ? ` · ${visit.place.area}` : ""}
          </span>
        </div>
      </header>
      <a href={`/visit/${visit.checkId}`} className="grid gap-3 text-foreground">
        {photo && (
          // Check photos are served from our own R2 proxy route.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={`Photo from ${visit.place.name}`} loading="lazy" className="aspect-[4/3] w-full rounded-2xl object-cover" />
        )}
        {visit.note && <p className="text-[15px] leading-relaxed">{visit.note}</p>}
      </a>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={visit.place.status} short />
        {visit.dishes.map((dish) => (
          <span key={dish} className="rounded-full bg-secondary px-3 py-1 text-[13px] font-extrabold">
            {dish}
          </span>
        ))}
      </div>
      <footer className="-ml-2 flex items-center gap-1">
        <LikeButton checkId={visit.checkId} initial={visit.likedByMe} count={visit.likes} />
        <a href={`/visit/${visit.checkId}#comments`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-sm font-extrabold text-foreground" aria-label="Comments">
          <Icon icon={BubbleChatIcon} size={20} />
          {visit.comments > 0 && visit.comments}
        </a>
        <span className="ml-auto flex items-center gap-1 text-sm font-extrabold">
          Want to try
          <SaveHeart placeId={visit.place.id} saved={visit.savedByMe} signedIn label={visit.place.name} />
        </span>
      </footer>
    </article>
  );
}
