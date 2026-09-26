import { Avatar, AvatarFallback } from "@halalfood/ui/components/avatar";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Spinner } from "@halalfood/ui/components/spinner";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@halalfood/ui/components/item";
import { cn } from "@halalfood/ui/lib/utils";
import { Illustration, type IllustrationName } from "./art";

/** An underlined, bold inline link. */
export function TextLink({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn("font-extrabold text-foreground underline underline-offset-3", className)}
      {...props}
    />
  );
}

/** A row of pill links or toggles that wraps. */
export function ChipRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap gap-2.5", className)} {...props} />;
}

/** A pill link, e.g. a city with its place count. */
export function ChipLink({
  href,
  active = false,
  hint,
  children,
  className,
}: {
  href: string;
  active?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="outline"
      className={cn(
        "h-10.5 rounded-full px-4 font-bold hover:border-foreground",
        active && "border-2 border-foreground bg-secondary",
        className,
      )}
    >
      <a href={href} aria-current={active ? "page" : undefined}>
        {children}
        {hint && <small className="font-semibold text-muted-foreground">{hint}</small>}
      </a>
    </Button>
  );
}

/** A soft, illustrated call to action. */
export function PromoCard({
  art,
  title,
  titleId,
  description,
  action,
  tone = "cream",
  className,
}: {
  art?: IllustrationName;
  titleId?: string;
  title: React.ReactNode;
  description: React.ReactNode;
  action?: React.ReactNode;
  tone?: "cream" | "honey";
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex-col items-start gap-4 rounded-3xl px-7 py-6 ring-0 sm:flex-row sm:items-center sm:gap-6",
        tone === "honey" ? "bg-warning-muted" : "bg-muted",
        className,
      )}
    >
      {art && <Illustration name={art} size={80} />}
      <div className="flex-1">
        <h2 id={titleId} className="mb-2 text-2xl">
          {title}
        </h2>
        <div className={tone === "honey" ? "text-warning-foreground" : "text-muted-foreground"}>
          {description}
        </div>
      </div>
      {action}
    </Card>
  );
}

/** The dark pill that floats over the bottom of a list, e.g. "Show map". */
export function FloatingPill({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "fixed bottom-24 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 py-3.5 text-sm font-extrabold text-background shadow-lg transition-transform hover:scale-105 md:bottom-7",
        className,
      )}
      {...props}
    />
  );
}

/** A muted inline box for "nothing here yet" copy, with bold underlined links. */
export function EmptyState({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "rounded-2xl bg-secondary p-5.5 text-muted-foreground [&_a]:font-extrabold [&_a]:text-foreground [&_a]:underline",
        className,
      )}
      {...props}
    />
  );
}

export function CityGrid({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5", className)}
      {...props}
    />
  );
}

/** A linked card with a monogram tile, used for cities and guides. */
export function CityCard({
  href,
  mark,
  title,
  meta,
  description,
}: {
  href: string;
  mark: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <Item asChild variant="outline" className="h-full gap-3.5 rounded-2xl p-3.5 hover:shadow-md">
      <a href={href}>
        <ItemMedia className="size-14 rounded-xl bg-muted font-black text-primary">
          {mark}
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="text-[15px] font-extrabold">{title}</ItemTitle>
          {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
          {description && (
            <ItemDescription className="text-[13px]">{description}</ItemDescription>
          )}
        </ItemContent>
      </a>
    </Item>
  );
}

/** First letters of up to two words, for a city monogram. */
export function monogram(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** A round initials avatar on a soft tint. */
export function InitialsAvatar({
  initials,
  tint = "#F6C9B0",
  size = 44,
  className,
}: {
  initials: string;
  tint?: string;
  size?: number;
  className?: string;
}) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn("shrink-0 after:hidden", className)}
      style={{ width: size, height: size }}
    >
      <AvatarFallback
        className="font-extrabold text-foreground"
        style={{ background: tint, fontSize: Math.round(size / 3) }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** A muted call-out with a title, a line of copy and an action. */
export function InlineCard({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid justify-items-start gap-2.5 rounded-2xl bg-secondary p-5.5", className)}>
      <strong className="text-base">{title}</strong>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** A bordered form with a heading and an optional note under it. */
export function FormCard({
  title,
  description,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"form">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <Card className={cn("px-5.5 py-5.5", className)}>
      <form className="grid gap-3.5" {...props}>
        {title && <h3 className="text-lg">{title}</h3>}
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        {children}
      </form>
    </Card>
  );
}

/** A spinner with a short status line. */
export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner /> {children}
    </p>
  );
}

/** One person's contribution in a list: avatar, name, date, then the content. */
export function EntryHead({
  name,
  meta,
  tint,
}: {
  name: string;
  meta: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <InitialsAvatar initials={name.trim().slice(0, 1).toUpperCase() || "H"} tint={tint} />
      <div>
        <strong className="block text-[15px]">{name}</strong>
        <span className="text-[13px] text-muted-foreground">{meta}</span>
      </div>
    </div>
  );
}
