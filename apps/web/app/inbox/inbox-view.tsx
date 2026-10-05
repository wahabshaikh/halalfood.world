"use client";

import { useEffect, useState } from "react";
import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import type { PlaceStatus } from "@halalfood/core/halal";
import type { RecReply } from "@halalfood/core/recs";
import { cn } from "@halalfood/ui/lib/utils";
import { Avatar, Icon, StatusPill, buttonClass } from "../../src/components/kit";
import { Segmented, api, errorText, toast } from "../../src/components/kit-client";
import { SendSheetButton } from "../../src/components/send-sheet";
import { timeAgo } from "../../src/components/time-ago";

type Actor = { userId: string; handle: string | null; name: string; avatarUrl: string | null };
type Activity = { id: string; kind: string; text: string; href: string; actor: Actor | null; createdAt: number; unread: boolean; pendingRequest: boolean };
type Rec = {
  id: string;
  sender: Actor;
  note: string | null;
  createdAt: number;
  unread: boolean;
  reply: RecReply | null;
  target:
    | { kind: "place"; id: string; name: string; area: string | null; status: PlaceStatus; saved: boolean }
    | { kind: "list"; id: string; name: string }
    | { kind: "event"; id: string; name: string; startsAt: number };
};

export function InboxView({ tab: initialTab, activity: initialActivity, recs: initialRecs }: { tab: "activity" | "recs"; activity: Activity[]; recs: Rec[] }) {
  const [tab, setTab] = useState(initialTab);
  const [activity, setActivity] = useState(initialActivity);
  const [recs, setRecs] = useState(initialRecs);

  const switchTab = (next: "activity" | "recs") => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "recs") url.searchParams.set("tab", "recs");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  };

  const markAll = async () => {
    try {
      await api("/api/inbox/read", { method: "POST", json: {} });
      setActivity((items) => items.map((item) => ({ ...item, unread: false })));
      setRecs((items) => items.map((item) => ({ ...item, unread: false })));
    } catch (error) {
      toast(errorText(error));
    }
  };

  // Opening a tab reads what's on it.
  useEffect(() => {
    const ids = (tab === "activity" ? activity : recs).filter((item) => item.unread).map((item) => item.id);
    if (!ids.length) return;
    const timer = window.setTimeout(() => void api("/api/inbox/read", { method: "POST", json: { ids } }).catch(() => {}), 1500);
    return () => window.clearTimeout(timer);
    // Only when the tab changes; the dots stay until the next visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const answer = async (item: Activity, accept: boolean) => {
    if (!item.actor?.handle) return;
    try {
      await api(`/api/follow-requests/${encodeURIComponent(item.actor.handle)}`, { method: accept ? "POST" : "DELETE" });
      setActivity((items) =>
        items.map((other) => (other.id === item.id ? { ...other, pendingRequest: false, text: accept ? `${item.actor!.name.split(" ")[0]} now follows you` : "Request declined" } : other)),
      );
    } catch (error) {
      toast(errorText(error));
    }
  };

  const reply = async (rec: Rec, value: RecReply) => {
    try {
      await api(`/api/recs/${rec.id}/reply`, { method: "POST", json: { reply: value } });
      setRecs((items) =>
        items.map((item) =>
          item.id === rec.id
            ? { ...item, reply: value, unread: false, target: item.target.kind === "place" && value === "want-to-try" ? { ...item.target, saved: true } : item.target }
            : item,
        ),
      );
    } catch (error) {
      toast(errorText(error));
    }
  };

  const unread = (tab === "activity" ? activity : recs).some((item) => item.unread);
  return (
    <div className="grid gap-4 px-5 pb-10">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Segmented
            label="Inbox"
            value={tab}
            onChange={switchTab}
            options={[
              { value: "activity", label: "Activity" },
              { value: "recs", label: `Recs${recs.some((rec) => rec.unread) ? " •" : ""}` },
            ]}
          />
        </div>
        <button type="button" onClick={markAll} disabled={!unread} className="text-sm font-extrabold text-foreground disabled:text-muted-foreground">
          Mark all read
        </button>
      </div>

      {tab === "activity" ? (
        activity.length ? (
          <ul className="grid">
            {activity.map((item) => (
              <li key={item.id} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
                <span className={cn("size-2 shrink-0 rounded-full", item.unread ? "bg-primary" : "bg-transparent")} aria-label={item.unread ? "Unread" : undefined} />
                {item.actor ? (
                  <Avatar name={item.actor.name} seed={item.actor.userId} src={item.actor.avatarUrl} size={40} />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-muted text-success">
                    <Icon icon={CheckmarkBadge01Icon} size={20} />
                  </span>
                )}
                <a href={item.href} className="grid min-w-0 flex-1 gap-0.5 text-foreground">
                  <span className="text-[15px] leading-snug font-semibold">{item.text}</span>
                  <span className="text-xs font-bold text-muted-foreground">{timeAgo(item.createdAt)}</span>
                </a>
                {item.pendingRequest && (
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => answer(item, true)} className={buttonClass("primary", "sm", "min-h-9 px-3")}>
                      Accept
                    </button>
                    <button type="button" onClick={() => answer(item, false)} className={buttonClass("outline", "sm", "min-h-9 px-3")}>
                      Decline
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-10 text-center text-sm font-semibold text-muted-foreground">Likes, comments, follows and status changes show up here.</p>
        )
      ) : (
        <div className="grid gap-3">
          {recs.map((rec) => (
            <article key={rec.id} className={cn("grid gap-3 rounded-2xl border p-4", rec.unread ? "border-primary/40 bg-accent/40" : "border-border")}>
              <header className="flex items-center gap-2.5">
                <Avatar name={rec.sender.name} seed={rec.sender.userId} src={rec.sender.avatarUrl} size={32} />
                <span className="flex-1 text-sm">
                  <strong className="font-black">{rec.sender.name.split(" ")[0]}</strong> sent you {rec.target.kind === "place" ? "a place" : rec.target.kind === "list" ? "a list" : "an event"}
                </span>
                <span className="text-xs font-bold text-muted-foreground">{timeAgo(rec.createdAt)}</span>
              </header>
              {rec.note && <p className="text-[15px] font-semibold">“{rec.note}”</p>}
              <a href={`/${rec.target.kind}/${rec.target.id}`} className="grid gap-1 rounded-xl bg-muted px-3.5 py-3 text-foreground">
                <strong className="text-[15px] font-extrabold">{rec.target.name}</strong>
                {rec.target.kind === "place" && <StatusPill status={rec.target.status} short className="w-fit" />}
              </a>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => reply(rec, "in")}
                  aria-pressed={rec.reply === "in"}
                  className={buttonClass(rec.reply === "in" ? "done" : "outline", "md")}
                >
                  {rec.reply === "in" ? "You’re in" : "I’m in"}
                </button>
                <button
                  type="button"
                  onClick={() => reply(rec, "want-to-try")}
                  aria-pressed={rec.reply === "want-to-try"}
                  className={buttonClass(rec.reply === "want-to-try" ? "done" : "outline", "md")}
                >
                  {rec.reply === "want-to-try" ? "Saved" : "Want to try"}
                </button>
              </div>
            </article>
          ))}
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-4">
            <span className="grid gap-0.5">
              <strong className="text-[15px] font-black">Send a place to a friend</strong>
              <span className="text-[13px] font-semibold text-muted-foreground">They’ll see it here.</span>
            </span>
            <SendSheetButton target={null} className={buttonClass("dark", "md", "px-4")} label="Send" />
          </div>
        </div>
      )}
    </div>
  );
}
