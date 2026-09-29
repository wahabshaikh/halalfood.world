import { cn } from "@halalfood/ui/lib/utils";

export type HomeTabKey = "for-you" | "friends";

/**
 * The two-tab home: "For you" is the existing Explore page and "Friends" is the
 * feed of visits from people you follow. Plain links, so both stay reachable
 * and crawlable without JavaScript.
 */
export function HomeTabs({ active }: { active: HomeTabKey }) {
  const tabs: { key: HomeTabKey; label: string; href: string }[] = [
    { key: "for-you", label: "For you", href: "/" },
    { key: "friends", label: "Friends", href: "/feed" },
  ];
  return (
    <nav
      className="mb-5 inline-flex rounded-full bg-secondary p-1"
      aria-label="Home"
    >
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
  );
}
