"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@halalfood/ui/components/button";
import { cn } from "@halalfood/ui/lib/utils";
import {
  NOTIFICATION_FILTERS,
  NOTIFICATION_FILTER_LABELS,
  type NotificationFilter,
  type NotificationItem,
} from "@halalfood/core/notifications";
import { relativeTime } from "@halalfood/core/feed";
import { InitialsAvatar, Loading, monogram } from "../../src/components/blocks";
import { EmptyPanel } from "../../src/components/site-chrome";
import { FormMessage } from "../../src/components/section";
import { goToLogin } from "../../src/components/visit-card";

type State = "loading" | "ready" | "unauthenticated" | "error";

const EMPTY: Record<NotificationFilter, { title: string; body: string }> = {
  all: {
    title: "Nothing new yet",
    body: "Follows, likes and comments show up here, along with any change to the halal status of a place you saved.",
  },
  halal: {
    title: "No halal updates",
    body: "If the status of a place on your want-to-try list changes, or a halal check of yours is reviewed, you will hear about it here.",
  },
  follows: {
    title: "No follow activity",
    body: "New followers and follow requests appear here.",
  },
};

export default function ActivityView() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [state, setState] = useState<State>("loading");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const load = useCallback(async (next: NotificationFilter, signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch(`/api/notifications?filter=${next}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) return setState("unauthenticated");
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { items?: NotificationItem[] };
      const list = Array.isArray(body.items) ? body.items : [];
      setItems(list);
      setState("ready");
      // Seeing them is reading them. The dots stay for this visit.
      const unread = list.filter((item) => item.unread).flatMap((item) => item.ids);
      if (unread.length)
        void fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unread.slice(0, 200) }),
        }).catch(() => undefined);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(filter, controller.signal);
    return () => controller.abort();
  }, [filter, load]);

  async function answerRequest(handle: string, accept: boolean) {
    setBusy(handle);
    setError("");
    try {
      const response = await fetch(`/api/follow-requests/${encodeURIComponent(handle)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      if (!response.ok) throw new Error();
      setItems((current) =>
        current.filter((item) => !(item.kind === "follow-request" && item.actorHandle === handle)),
      );
    } catch {
      setError("That didn’t go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function followBack(handle: string) {
    setBusy(handle);
    setError("");
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(handle)}`, { method: "POST" });
      if (!response.ok) throw new Error();
      setFollowed((current) => new Set(current).add(handle));
    } catch {
      setError("Could not follow them. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
    setItems((current) => current.map((item) => ({ ...item, unread: false })));
  }

  if (state === "unauthenticated")
    return (
      <EmptyPanel
        art="visits"
        title="Sign in to see your activity"
        description="Halal status changes at places you saved, follows, likes and comments all land here."
      >
        <Button size="xl" onClick={() => goToLogin("activity")}>
          Log in or sign up
        </Button>
      </EmptyPanel>
    );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Activity filter">
          {NOTIFICATION_FILTERS.map((key) => (
            <Button
              key={key}
              role="tab"
              aria-selected={filter === key}
              variant="outline"
              className={cn(
                "h-9 rounded-full px-4 font-bold",
                filter === key && "border-2 border-foreground bg-secondary",
              )}
              onClick={() => setFilter(key)}
            >
              {NOTIFICATION_FILTER_LABELS[key]}
            </Button>
          ))}
        </div>
        {items.some((item) => item.unread) && (
          <Button variant="ghost" size="sm" onClick={() => void markAll()}>
            Mark all read
          </Button>
        )}
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {state === "loading" && <Loading>Loading your activity…</Loading>}
      {state === "error" && (
        <FormMessage tone="error">
          Could not load your activity.{" "}
          <button className="underline" onClick={() => void load(filter)}>
            Try again
          </button>
        </FormMessage>
      )}
      {state === "ready" && !items.length && (
        <EmptyPanel art="visits" titleAs="h2" title={EMPTY[filter].title} description={EMPTY[filter].body} />
      )}

      {state === "ready" && items.length > 0 && (
        <ul className="divide-y" data-testid="activity-list">
          {items.map((item) => {
            const handle = item.actorHandle;
            const isStatus = item.kind === "status-changed";
            return (
              <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3.5 py-4">
                {isStatus ? (
                  <span
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full",
                      item.downgrade ? "bg-destructive/10 text-destructive" : "bg-warning-muted text-warning-foreground",
                    )}
                    aria-hidden="true"
                  >
                    <HugeiconsIcon icon={Alert02Icon} size={22} />
                  </span>
                ) : (
                  <InitialsAvatar initials={monogram(handle ?? "halalfood")} size={44} />
                )}
                <div className="min-w-0">
                  <a href={item.href} className="block leading-snug hover:underline">
                    {item.parts.map((part, index) =>
                      part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>,
                    )}
                  </a>
                  {item.detail && (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {item.detail}{" "}
                      {isStatus && (
                        <a href={item.href} className="font-bold text-foreground underline underline-offset-3">
                          See evidence
                        </a>
                      )}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[13px] text-muted-foreground">
                    <span>{relativeTime(item.createdAt)}</span>
                    {item.unread && (
                      <span className="size-2 rounded-full bg-primary" aria-label="Unread" role="img" />
                    )}
                  </div>
                  {item.kind === "follow-request" && handle && (
                    <div className="mt-2.5 flex gap-2">
                      <Button size="sm" disabled={busy === handle} onClick={() => void answerRequest(handle, true)}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === handle}
                        onClick={() => void answerRequest(handle, false)}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
                {item.kind === "follow" && handle && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === handle || followed.has(handle)}
                    onClick={() => void followBack(handle)}
                  >
                    {followed.has(handle) ? "Following" : "Follow back"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
