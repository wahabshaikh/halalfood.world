import type { ReactNode } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Logo } from "./brand";
import { Icon } from "./kit";
import { NavTabs, type TabKey } from "./nav-tabs";
import { Toaster } from "./kit-client";

/**
 * Every screen sits in this frame: a five-tab bar on phones that becomes a top
 * bar at md, one centred 6xl column, and a one-line footer (spec §3.1).
 *
 * The top bar, the page content and the footer share the same frame and the
 * same `page-x` gutter, so their edges line up. Pages put their content in
 * `<Page>` (see kit.tsx) rather than choosing their own side padding.
 */
export function AppShell({
  active,
  children,
  width = "default",
  hideNav = false,
  footer = true,
}: {
  active?: TabKey;
  children: ReactNode;
  /** `full` lets a page (the map) use the whole viewport below the top bar. */
  width?: "default" | "full";
  hideNav?: boolean;
  footer?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {hideNav && (
        <header className="hidden border-b border-border md:block">
          <div className="mx-auto flex h-16 max-w-6xl items-center page-x">
            <a href="/" aria-label="halalfood.world home">
              <Logo compact />
            </a>
          </div>
        </header>
      )}
      {!hideNav && (
        <header className="sticky top-0 z-40 hidden border-b border-border bg-background/95 backdrop-blur md:block">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 page-x">
            <a href="/" aria-label="halalfood.world home" className="shrink-0">
              <Logo compact />
            </a>
            <form action="/search" role="search" className="min-w-0 max-w-sm flex-1 lg:max-w-md">
              <label htmlFor="header-search" className="sr-only">
                Search places, dishes, people
              </label>
              <span className="flex h-10 items-center gap-2.5 rounded-full bg-secondary px-4 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
                <Icon icon={Search01Icon} size={18} className="shrink-0 text-foreground" />
                <input
                  id="header-search"
                  name="q"
                  type="search"
                  maxLength={120}
                  placeholder="Search places, dishes, people"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
                />
              </span>
            </form>
            <NavTabs active={active} variant="top" />
          </div>
        </header>
      )}
      <main
        className={cn(
          "w-full flex-1",
          width === "default" && "mx-auto max-w-6xl",
          !hideNav && "pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-12",
        )}
      >
        {children}
      </main>
      {footer && (
        <footer className="hidden border-t border-border md:block">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-1 page-x py-6 text-sm text-muted-foreground">
            <span>© {new Date().getFullYear()} halalfood.world</span>
            <span>Place details from Google</span>
          </div>
        </footer>
      )}
      {!hideNav && <NavTabs active={active} variant="bottom" />}
      <Toaster />
    </div>
  );
}
