import type { ReactNode } from "react";
import { cn } from "@halalfood/ui/lib/utils";
import { Logo } from "./brand";
import { NavTabs, type TabKey } from "./nav-tabs";

/**
 * Every screen sits in this frame: a five-tab bar on phones that becomes a top
 * bar at md, a centred column, and a one-line footer (spec §3.1).
 */
export function AppShell({
  active,
  children,
  width = "narrow",
  hideNav = false,
  footer = true,
}: {
  active?: TabKey;
  children: ReactNode;
  width?: "narrow" | "wide" | "full";
  hideNav?: boolean;
  footer?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {!hideNav && (
        <header className="sticky top-0 z-40 hidden border-b border-border bg-background/95 backdrop-blur md:block">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
            <a href="/" aria-label="halalfood.world home">
              <Logo compact />
            </a>
            <NavTabs active={active} variant="top" />
          </div>
        </header>
      )}
      <main
        className={cn(
          "mx-auto w-full flex-1",
          width === "narrow" && "max-w-2xl",
          width === "wide" && "max-w-6xl",
          !hideNav && "pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-10",
        )}
      >
        {children}
      </main>
      {footer && (
        <footer className="hidden border-t border-border md:block">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-1 px-6 py-5 text-sm text-muted-foreground">
            <span>© {new Date().getFullYear()} halalfood.world</span>
            <span>Place details from Google</span>
          </div>
        </footer>
      )}
      {!hideNav && <NavTabs active={active} variant="bottom" />}
    </div>
  );
}
