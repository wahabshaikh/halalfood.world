/**
 * Building blocks for the /certifiers section (for exporters). Server-safe.
 * Status always comes from an official list, shown with that list's link and the date we last checked it.
 */
import type { ReactNode } from "react";
import { Alert02Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, formatDay, type DisplayStatus } from "@/lib/certifiers/display";
import { scopeLabel } from "@/lib/certifiers/scopes";
import { jsonLdScript } from "@/lib/seo";
import { Icon } from "./kit";

const STATUS_TONE: Record<DisplayStatus, string> = {
  recognised: "bg-success-muted text-success",
  expired: "bg-destructive-muted text-destructive",
  suspended: "bg-warning-muted text-warning-strong",
  removed: "bg-neutral-pill text-neutral-pill-foreground",
  pending: "bg-neutral-pill text-neutral-pill-foreground",
};

export function CertStatusPill({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-black whitespace-nowrap", STATUS_TONE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Our scope labels, with the official wording one hover away. */
export function ScopeList({ scopes, raw }: { scopes: readonly string[]; raw?: string | null }) {
  if (!scopes.length) return <span className="text-muted-foreground">{raw?.trim() || "Not given"}</span>;
  return (
    <span title={raw ? `Official wording: ${raw.split("|").join(", ")}` : undefined}>{scopes.map(scopeLabel).join(", ")}</span>
  );
}

/** "Checked against the official list on 17 Oct 2026", linked to the list. */
export function CheckedLine({ url, checkedAt, label = "the official list" }: { url: string; checkedAt: number | null; label?: string }) {
  const day = formatDay(checkedAt);
  return (
    <p className="text-sm font-semibold text-subtle-foreground">
      {day ? <>Checked against </> : <>Source: </>}
      <a href={url} rel="noopener" className="font-extrabold text-foreground underline underline-offset-4 hover:text-primary">
        {label}
        <Icon icon={LinkSquare02Icon} size={14} className="ml-1 inline align-[-2px]" />
      </a>
      {day && <> on {day}</>}.
    </p>
  );
}

export function ConfirmNote({ children }: { children?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-warning/50 bg-warning-muted p-4 text-sm font-semibold text-warning-foreground">
      <Icon icon={Alert02Icon} size={20} className="mt-0.5 shrink-0" />
      <p>
        <strong className="font-black">Always confirm with the authority before shipping.</strong>{" "}
        {children ?? "This page copies the official list so it is easy to search. The official list is what counts, and rules can change."}
      </p>
    </div>
  );
}

const SECTION_LINKS = [
  { href: "/certifiers", label: "Directory" },
  { href: "/certifiers/country/indonesia", label: "Indonesia" },
  { href: "/certifiers/changes", label: "Changes" },
  { href: "/certifiers/alerts", label: "Alerts" },
  { href: "/certifiers/methodology", label: "Methodology" },
] as const;

/** The section's own links: it is a B2B corner of the site, so it carries its own small nav. */
export function CertifiersNav({ active }: { active?: (typeof SECTION_LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Certifiers" className="-mx-1 flex flex-wrap gap-1.5">
      <span className="sr-only">For exporters:</span>
      {SECTION_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          aria-current={active === link.href ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center rounded-full px-3.5 text-sm font-extrabold",
            active === link.href ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/70",
          )}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}

/** A plain prose block for guides and methodology. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="grid max-w-3xl gap-4 text-[15px] leading-relaxed text-foreground md:text-base [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-black [&_li]:ml-5 [&_ol]:grid [&_ol]:list-decimal [&_ol]:gap-1.5 [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5">
      {children}
    </div>
  );
}
