"use client";

import { useState } from "react";
import { Avatar, buttonClass } from "../../src/components/kit";
import { api, errorText, toast } from "../../src/components/kit-client";
import { FollowButton } from "../../src/components/people-client";
import { VisitCard, type VisitJson } from "../../src/components/visit-card";

export function FeedList({ initial, next: firstNext }: { initial: VisitJson[]; next: number | null }) {
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(firstNext);
  const [busy, setBusy] = useState(false);
  const more = async () => {
    if (!next || busy) return;
    setBusy(true);
    try {
      const page = await api<{ items: VisitJson[]; next: number | null }>(`/api/feed?cursor=${next}`);
      setItems((current) => [...current, ...page.items]);
      setNext(page.next);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid">
      {items.map((visit) => (
        <VisitCard key={visit.checkId} visit={visit} />
      ))}
      {next && (
        <button type="button" onClick={more} disabled={busy} className={buttonClass("outline", "md", "mt-4")}>
          {busy ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function SuggestedPeople({ people }: { people: { handle: string; name: string; avatarUrl: string | null }[] }) {
  if (!people.length) return null;
  return (
    <section className="grid gap-2">
      <h2 className="text-[17px] font-black">People to follow</h2>
      <ul className="grid">
        {people.map((person) => (
          <li key={person.handle} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
            <a href={`/u/${person.handle}`} className="flex min-w-0 flex-1 items-center gap-3 text-foreground">
              <Avatar name={person.name} seed={person.handle} src={person.avatarUrl} size={44} />
              <span className="grid min-w-0">
                <strong className="truncate text-[15px] font-extrabold">{person.name}</strong>
                <span className="truncate text-[13px] font-semibold text-muted-foreground">@{person.handle}</span>
              </span>
            </a>
            <FollowButton handle={person.handle} initial="none" size="sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}
