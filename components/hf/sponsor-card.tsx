import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import type { SponsorCard as Sponsor } from "@/lib/sponsorships";
import { Icon } from "./kit";

/**
 * A city's sponsor, labelled as one and kept apart from the place list. It links out with
 * rel="sponsored" and never changes what places show or in which order.
 */
export function SponsorCard({ sponsor, cityLabel, preview = false }: { sponsor: Sponsor; cityLabel: string; preview?: boolean }) {
  let host = sponsor.linkUrl;
  try {
    host = new URL(sponsor.linkUrl).hostname.replace(/^www\./, "");
  } catch {
    // Stored links are validated; fall back to the raw text if one isn't.
  }
  const body = (
    <>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[11px] font-extrabold tracking-[0.08em] text-muted-foreground uppercase">Sponsor · {cityLabel}</span>
        <span className="truncate text-[17px] font-black text-foreground">{sponsor.name}</span>
        {sponsor.tagline && <span className="line-clamp-2 text-sm font-semibold text-subtle-foreground">{sponsor.tagline}</span>}
        <span className="truncate text-xs font-bold text-muted-foreground">{host}</span>
      </span>
      <Icon icon={ArrowUpRight01Icon} size={20} className="shrink-0 text-muted-foreground" />
    </>
  );
  const className = "flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3";
  if (preview) return <div className={className}>{body}</div>;
  return (
    <aside aria-label={`Sponsor of ${cityLabel}`}>
      <a href={sponsor.linkUrl} target="_blank" rel="sponsored noopener noreferrer" className={`${className} transition-colors hover:bg-muted`}>
        {body}
      </a>
      <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
        Sponsors support halalfood.world. They never change a place&apos;s status or ranking.{" "}
        <a href="/sponsor" className="underline underline-offset-2 hover:text-foreground">
          Sponsor a city
        </a>
      </p>
    </aside>
  );
}

/** "18 Nov 2026", in UTC so server and browser agree. */
export function sponsorDate(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(at));
}
