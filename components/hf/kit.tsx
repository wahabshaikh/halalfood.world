/**
 * The shared building blocks every screen is composed from (spec §7.2).
 * Server-safe: nothing here uses hooks. Interactive pieces live in
 * kit-client.tsx.
 */
import type { ComponentProps, ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  HelpCircleIcon,
  Tick02Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import {
  factAnswerLabel,
  factTags,
  factTone,
  FACT_QUESTION,
  statusLabel,
  type Definite,
  type Fact,
  type FactTone,
  type PlaceStatus,
} from "@/lib/core/halal";
import { placeInitials } from "./place-photo";

export function Icon({
  icon,
  size = 20,
  className,
  strokeWidth = 2,
}: {
  icon: IconSvgElement;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}

/* ------------------------------------------------------------------------ */
/* Buttons                                                                    */
/* ------------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "dark" | "outline" | "ghost" | "danger" | "done";
export type ButtonSize = "md" | "lg" | "sm";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "lg", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-extrabold transition-colors select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:bg-border disabled:text-muted-foreground disabled:border-border",
    size === "lg" && "min-h-[54px] rounded-[14px] px-5 text-base",
    size === "md" && "min-h-11 rounded-xl px-4 text-[15px]",
    size === "sm" && "min-h-10 rounded-full px-3.5 text-sm",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
    variant === "dark" && "bg-foreground text-background hover:bg-foreground/90",
    variant === "outline" && "border border-input bg-background text-foreground hover:bg-secondary",
    variant === "ghost" && "text-foreground hover:bg-secondary",
    variant === "danger" && "text-destructive hover:bg-destructive-muted",
    variant === "done" && "border border-success bg-success-muted text-success",
    className,
  );
}

export function LinkButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"a"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <a className={buttonClass(variant, size, className)} {...props} />;
}

export function IconLink({
  label,
  icon,
  className,
  badge,
  ...props
}: ComponentProps<"a"> & { label: string; icon: IconSvgElement; badge?: number }) {
  return (
    <a
      aria-label={badge ? `${label}, ${badge} new` : label}
      className={cn("relative inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-secondary", className)}
      {...props}
    >
      <Icon icon={icon} size={22} />
      {badge ? (
        <span className="absolute top-1.5 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-background bg-primary px-1 text-[11px] font-black text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </a>
  );
}

/* ------------------------------------------------------------------------ */
/* Bars                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * The page frame inside AppShell. Every page puts its content in one of these
 * so the gutters and the top spacing are the same everywhere.
 *   full     the whole 6xl frame, for grids and two-column layouts
 *   content  a centred reading column, for feeds, lists and settings
 *   form     a narrower centred column, for one-task forms
 */
const PAGE_WIDTH = { full: "", content: "max-w-3xl", form: "max-w-xl" } as const;

export function Page({
  size = "full",
  className,
  children,
}: {
  size?: keyof typeof PAGE_WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full page-x pt-4 md:pt-8", PAGE_WIDTH[size], className)}>{children}</div>;
}

/**
 * One-task screens (sign in, check a place, add a place, onboarding): a
 * narrow column that sits in a bordered card on desktop. `fill` makes it at
 * least a screen tall on phones so its last button can sit at the bottom.
 */
export function FormCard({ className, fill = false, children }: { className?: string; fill?: boolean; children: ReactNode }) {
  return (
    <Page size="form" className={cn("pt-6 md:pt-12", fill && "max-md:flex max-md:min-h-dvh max-md:flex-col")}>
      <div className={cn("md:rounded-[24px] md:border md:border-border md:p-8", fill && "flex flex-col max-md:flex-1", className)}>{children}</div>
    </Page>
  );
}

/**
 * A list of rows is a plain divided list on phones and a grid of bordered
 * cards from md. `LIST_GRID` goes on the <ul>, `ROW_CARD` on each <li> (or the
 * link that fills it), so every list on the site reads the same.
 */
export const LIST_GRID = "md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3";
export const ROW_CARD = "md:rounded-2xl md:border md:border-border md:px-4 md:transition-colors md:hover:bg-muted";

/** Back or close, an optional title and actions. Sits inside a Page, flush with its text edge. */
export function TopBar({
  back,
  close,
  title,
  children,
  className,
}: {
  back?: string;
  close?: string;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("-mx-2.5 -mt-1 mb-1 flex min-h-12 items-center gap-1.5 md:mb-3", className)}>
      {back && <IconLink href={back} label="Back" icon={ArrowLeft01Icon} />}
      {close && <IconLink href={close} label="Close" icon={Cancel01Icon} />}
      {title && <h1 className="min-w-0 truncate text-xl font-black">{title}</h1>}
      {children && <div className="ml-auto flex items-center gap-0.5">{children}</div>}
    </header>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h1 className="text-[28px] leading-tight font-black tracking-tight md:text-[34px]">{children}</h1>
      {sub && <p className="text-[15px] font-semibold text-subtle-foreground md:text-base">{sub}</p>}
    </div>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-[19px] font-black md:text-xl">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="text-[13px] font-extrabold tracking-[0.06em] text-muted-foreground uppercase">{children}</h2>;
}

/* ------------------------------------------------------------------------ */
/* Status                                                                     */
/* ------------------------------------------------------------------------ */

const STATUS_TONE: Record<PlaceStatus["kind"], string> = {
  verified: "bg-success-muted text-success",
  checking: "bg-warning-muted text-warning-strong",
  unchecked: "bg-neutral-pill text-neutral-pill-foreground",
};

export function StatusPill({ status, short = false, className }: { status: PlaceStatus; short?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-xs font-extrabold whitespace-nowrap",
        STATUS_TONE[status.kind],
        className,
      )}
    >
      {statusLabel(status, short)}
    </span>
  );
}

export function Meter({ filled, tone, size = "md" }: { filled: 0 | 1 | 2 | 3; tone: PlaceStatus["kind"]; size?: "md" | "lg" }) {
  const on = tone === "verified" ? "bg-success" : tone === "checking" ? "bg-warning-strong" : "bg-muted-foreground";
  return (
    <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span key={index} className={cn("rounded-full", size === "lg" ? "h-2" : "h-1.5", index < filled ? on : "bg-foreground/12")} />
      ))}
    </div>
  );
}

/** `people` is everyone whose latest check counts; three is the minimum, not a cap. */
export function statusSubline(status: PlaceStatus, latest: string | null, people = 3): string {
  if (status.kind === "verified") {
    if (people <= 0) return "Confirmed by reviewed documents";
    const who = people === 1 ? "1 person checked it" : `${people} people checked separately and agree`;
    return `${who}${latest ? ` · latest ${latest}` : ""}`;
  }
  if (status.kind === "checking")
    return status.progress === 2
      ? "One more matching check makes this Verified"
      : "Two more matching checks to verify";
  return "Nobody has checked this place. That doesn’t mean it isn’t halal.";
}

export function StatusCard({
  status,
  latest,
  people,
  how,
  className,
}: {
  status: PlaceStatus;
  latest: string | null;
  /** People whose latest check counts. */
  people?: number;
  /** The "How verification works" trigger. */
  how: ReactNode;
  className?: string;
}) {
  const filled = status.kind === "verified" ? 3 : status.kind === "checking" ? status.progress : 0;
  const tone = {
    verified: "bg-success-muted text-success",
    checking: "bg-warning-muted text-warning-strong",
    unchecked: "bg-neutral-pill text-foreground/85",
  }[status.kind];
  const iconTone = {
    verified: "bg-success text-success-foreground",
    checking: "bg-warning-strong text-white",
    unchecked: "bg-muted-foreground text-white",
  }[status.kind];
  const icon = status.kind === "verified" ? Tick02Icon : status.kind === "checking" ? Clock01Icon : HelpCircleIcon;
  const title =
    status.kind === "verified" ? "Verified" : status.kind === "checking" ? `${status.progress} of 3 checks` : "Not checked yet";
  return (
    <section aria-label="Halal status" className={cn("grid gap-3 rounded-[20px] p-4 lg:p-5", tone, className)}>
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", iconTone)}>
          <Icon icon={icon} size={20} strokeWidth={2.6} />
        </span>
        <div className="grid">
          <strong className="text-[17px] font-black">{title}</strong>
          <span className="text-[13px] font-bold opacity-85">{statusSubline(status, latest, people)}</span>
        </div>
      </div>
      <Meter filled={filled} tone={status.kind} />
      {how}
    </section>
  );
}

const TONE_DOT: Record<FactTone, string> = {
  good: "bg-success-muted text-success",
  bad: "bg-destructive-muted text-destructive",
  neutral: "bg-neutral-pill text-neutral-pill-foreground",
  unknown: "bg-secondary text-muted-foreground",
};

export function FactTile({ fact, value, evidence }: { fact: Fact; value: Definite | null; evidence?: string }) {
  const tone = factTone(fact, value);
  const icon = tone === "unknown" ? HelpCircleIcon : tone === "good" ? Tick02Icon : Cancel01Icon;
  return (
    <div className="grid content-start gap-2.5 rounded-2xl border border-border p-3.5 lg:flex lg:items-start lg:gap-3.5 lg:p-4">
      <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-full", TONE_DOT[tone])}>
        <Icon icon={icon} size={16} strokeWidth={3} />
      </span>
      <div className="grid gap-0.5">
        <span className="text-[13px] font-bold text-muted-foreground">{FACT_QUESTION[fact]}</span>
        <strong className="text-base font-black">{factAnswerLabel(fact, value)}</strong>
        {evidence ? <span className="text-xs font-bold text-muted-foreground">{evidence}</span> : null}
      </div>
    </div>
  );
}

const TAG_TONE: Record<FactTone, string> = {
  good: "text-success",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

export function FactTags({ facts }: { facts: Record<Fact, Definite | null> }) {
  return (
    <>
      {factTags(facts).map((tag) => (
        <span key={tag.text} className={cn("text-xs font-bold", TAG_TONE[tag.tone])}>
          {tag.text}
        </span>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* People and art                                                             */
/* ------------------------------------------------------------------------ */

const PAIRS = [
  ["#D3E0E6", "#2F4A5E"],
  ["#DCE8D5", "#2E5A36"],
  ["#E8DDF0", "#5A3A6B"],
  ["#F6E2B3", "#6B4A0E"],
  ["#F1D3B6", "#7A3E14"],
] as const;

export function artPair(seed: string): readonly [string, string] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return PAIRS[Math.abs(hash) % PAIRS.length];
}

export function initialsOf(name: string): string {
  return placeInitials(name);
}

export function Avatar({
  name,
  seed,
  src,
  size = 40,
  className,
  ring = false,
}: {
  name: string;
  seed?: string;
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const [bg, ink] = artPair(seed ?? name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black",
        ring && "border-2 border-background",
        className,
      )}
      style={{ width: size, height: size, background: bg, color: ink, fontSize: Math.round(size / 3) }}
      aria-hidden="true"
    >
      {src ? (
        // Avatars are served from our own R2 proxy route.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

export function AvatarStack({ people, size = 32 }: { people: { name: string; seed?: string; src?: string | null }[]; size?: number }) {
  return (
    <span className="flex" aria-hidden="true">
      {people.slice(0, 3).map((person, index) => (
        <Avatar
          key={(person.seed ?? person.name) + index}
          name={person.name}
          seed={person.seed}
          src={person.src}
          size={size}
          ring
          className={index ? "-ml-2.5" : undefined}
        />
      ))}
    </span>
  );
}

/** A place's photo, or its initials on a stable colour. */
export function PlaceArt({
  name,
  seed,
  src,
  className,
  rounded = "rounded-2xl",
  textSize = "text-xl",
}: {
  name: string;
  seed: string;
  src?: string | null;
  className?: string;
  rounded?: string;
  textSize?: string;
}) {
  const [bg, ink] = artPair(seed);
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center overflow-hidden font-black", rounded, textSize, className)}
      style={{ background: bg, color: ink }}
      aria-hidden="true"
    >
      {src ? (
        // Place photos are served from our own R2 proxy route.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* States                                                                     */
/* ------------------------------------------------------------------------ */

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  icon?: IconSvgElement;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-10 text-center md:py-20">
      {icon && (
        <span className="mb-1 flex size-[76px] items-center justify-center rounded-full bg-accent text-primary">
          <Icon icon={icon} size={34} />
        </span>
      )}
      <p className="text-[17px] font-extrabold">{title}</p>
      {body && <p className="max-w-80 text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-xl bg-secondary", className)} aria-hidden="true" />;
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 items-center rounded-full bg-secondary px-3 text-[13px] font-extrabold", className)}>
      {children}
    </span>
  );
}
