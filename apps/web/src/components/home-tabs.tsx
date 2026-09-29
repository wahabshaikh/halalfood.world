import { cn } from "@halalfood/ui/lib/utils";
import { HeaderActions } from "./header-actions";

/** "activity" and "recs" are the bell and paper-plane pages, which share this header. */
export type HomeTabKey = "for-you" | "friends" | "activity" | "recs";

/**
 * The two-tab home: "For you" is the existing Explore page and "Friends" is the
 * feed of visits from people you follow. Plain links, so both stay reachable
 * and crawlable without JavaScript. The bell and paper plane sit at the right,
 * as in Corner's home header, and only appear for a signed-in diner.
 */
export function HomeTabs({ active }: { active: HomeTabKey }) {
  const tabs: { key: HomeTabKey; label: string; href: string }[] = [
    { key: "for-you", label: "For you", href: "/" },
    { key: "friends", label: "Friends", href: "/feed" },
  ];
  return (
    <div className="flex items-start justify-between gap-3">
      <nav className="mb-5 inline-flex rounded-full bg-secondary p-1" aria-label="Home">
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-full px-5 py-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground",
              tab.key === active && "bg-background text-foreground shadow-xs",
            )}
            aria-current={tab.key === active ? "page" : undefined}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      <HeaderActions active={active === "activity" || active === "recs" ? active : undefined} />
    </div>
  );
}
