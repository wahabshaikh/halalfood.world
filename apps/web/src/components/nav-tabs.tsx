"use client";

import { useEffect, useState } from "react";
import {
  AddSquareIcon,
  Compass01Icon,
  FavouriteIcon,
  UserCircleIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@halalfood/ui/lib/utils";
import { Icon } from "./kit";

export type TabKey = "explore" | "friends" | "add" | "saved" | "you";

const TABS: { key: TabKey; label: string; href: string; icon: typeof Compass01Icon }[] = [
  { key: "explore", label: "Explore", href: "/", icon: Compass01Icon },
  { key: "friends", label: "Friends", href: "/friends", icon: UserGroupIcon },
  { key: "add", label: "Add", href: "/add", icon: AddSquareIcon },
  { key: "saved", label: "Saved", href: "/saved", icon: FavouriteIcon },
  { key: "you", label: "You", href: "/me", icon: UserCircleIcon },
];

/** Unread inbox count, shared by every tab bar on the page. */
let unreadRequest: Promise<number> | null = null;
function loadUnread(): Promise<number> {
  unreadRequest ??= fetch("/api/inbox/summary", { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : { unread: 0 }))
    .then((body: { unread?: number }) => (Number.isFinite(body.unread) ? Number(body.unread) : 0))
    .catch(() => 0);
  return unreadRequest;
}

export function useUnread(): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let live = true;
    loadUnread().then((count) => live && setUnread(count));
    return () => {
      live = false;
    };
  }, []);
  return unread;
}

export function NavTabs({ active, variant }: { active?: TabKey; variant: "top" | "bottom" }) {
  const unread = useUnread();
  if (variant === "top")
    return (
      <nav aria-label="Main" className="ml-auto flex shrink-0 items-center gap-1">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm lg:px-3.5 font-extrabold text-muted-foreground hover:bg-secondary hover:text-foreground",
              tab.key === active && "bg-secondary text-foreground",
            )}
          >
            <Icon icon={tab.icon} size={18} />
            <span className="max-lg:sr-only">{tab.label}</span>
            {tab.key === "friends" && unread > 0 && (
              <span className="size-2 rounded-full bg-primary" aria-label={`${unread} new`} />
            )}
          </a>
        ))}
      </nav>
    );
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-border bg-background px-1 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))] md:hidden"
    >
      {TABS.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-extrabold text-muted-foreground",
            tab.key === active && "text-primary",
          )}
        >
          <Icon icon={tab.icon} size={24} />
          <span>{tab.label}</span>
          {tab.key === "friends" && unread > 0 && tab.key !== active && (
            <span className="absolute top-0.5 left-1/2 ml-2 size-[9px] rounded-full border-2 border-background bg-primary" aria-label={`${unread} new`} />
          )}
        </a>
      ))}
    </nav>
  );
}
