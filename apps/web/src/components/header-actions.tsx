"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Notification01Icon, SentIcon } from "@hugeicons/core-free-icons";
import { unreadBadge } from "@halalfood/core/notifications";
import { cn } from "@halalfood/ui/lib/utils";
import { getClientSession } from "../lib/client-session";

type Summary = { unread: number; recs: number };

/**
 * The bell and the paper plane from Corner's home header: activity (including
 * halal status changes at places you saved) and the recs inbox. They only
 * appear once we know the visitor is signed in, so signed-out pages stay
 * static and add no request of their own.
 */
export function HeaderActions({ active }: { active?: "activity" | "recs" }) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const user = await getClientSession();
      if (!user) return;
      const response = await fetch("/api/notifications/summary", {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as Partial<Summary>;
      setSummary({ unread: Number(body.unread) || 0, recs: Number(body.recs) || 0 });
    })().catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!summary) return null;

  const links = [
    { key: "activity" as const, href: "/activity", label: "Activity", icon: Notification01Icon, count: summary.unread },
    { key: "recs" as const, href: "/recs", label: "Recs", icon: SentIcon, count: summary.recs },
  ];
  return (
    <div className="mb-5 ml-auto flex items-center gap-1" data-testid="header-actions">
      {links.map((link) => {
        const badge = unreadBadge(link.count);
        return (
          <a
            key={link.key}
            href={link.href}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-full hover:bg-secondary",
              active === link.key && "bg-secondary",
            )}
            aria-label={badge ? `${link.label}, ${badge} unread` : link.label}
            aria-current={active === link.key ? "page" : undefined}
          >
            <HugeiconsIcon icon={link.icon} size={22} aria-hidden="true" />
            {badge && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-4.5 rounded-full bg-primary px-1 text-center text-[11px] leading-[18px] font-extrabold text-primary-foreground"
                aria-hidden="true"
              >
                {badge}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
