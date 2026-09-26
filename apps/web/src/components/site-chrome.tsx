import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Compass01Icon,
  FavouriteIcon,
  MapsIcon,
  Menu01Icon,
  Search01Icon,
  UserCircleIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@halalfood/ui/components/breadcrumb";
import { Button } from "@halalfood/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@halalfood/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@halalfood/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@halalfood/ui/components/input-group";
import { Separator } from "@halalfood/ui/components/separator";
import { cn } from "@halalfood/ui/lib/utils";
import { Fragment } from "react";
import { APPROXIMATE_NOTE } from "../lib/seo";
import { Logo } from "./brand";
import { Eyebrow, Lead } from "./section";
import { Illustration, type IllustrationName } from "./art";

export type TabKey = "explore" | "map" | "saved" | "community" | "add";

/** The page frame: header and footer sit around a flexible main column. */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex min-h-screen flex-col", className)}>{children}</div>;
}

/** The centred content column every page renders into. */
export function PageMain({
  narrow = false,
  className,
  children,
  ...props
}: React.ComponentProps<"main"> & { narrow?: boolean }) {
  return (
    <main
      className={cn(
        "mx-auto w-full flex-1 px-4.5 pt-6 pb-16 md:px-6",
        narrow ? "max-w-3xl" : "max-w-7xl",
        className,
      )}
      {...props}
    >
      {children}
    </main>
  );
}

/** Eyebrow, title and lead at the top of a page. */
export function PageIntro({
  eyebrow,
  title,
  titleId,
  lead,
  className,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  titleId?: string;
  lead?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("grid gap-2.5 pt-3 pb-7", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 id={titleId} className="text-[clamp(28px,4vw,40px)] leading-tight">
        {title}
      </h1>
      {lead && <Lead>{lead}</Lead>}
      {children}
    </header>
  );
}

/** A pill search box that submits to /search, like a stay-search bar. */
export function HeaderSearch({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form
      className="w-full justify-self-center md:max-w-md"
      action="/search"
      method="get"
      role="search"
    >
      <InputGroup className="h-13 rounded-full bg-background pl-2 shadow-md md:h-12">
        <label className="sr-only" htmlFor="header-search-input">
          Search halal places or cities
        </label>
        <InputGroupInput
          id="header-search-input"
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder="Search places or cities"
          maxLength={120}
          autoComplete="off"
          className="font-semibold"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="size-9 rounded-full"
            aria-label="Search"
          >
            <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={3} aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

const MENU_GROUPS: { href: string; label: string }[][] = [
  [
    { href: "/map", label: "Map" },
    { href: "/cities", label: "Cities" },
    { href: "/guides", label: "City guides" },
    { href: "/add", label: "Add a place" },
  ],
  [
    { href: "/saved", label: "Saved" },
    { href: "/lists", label: "Lists" },
    { href: "/passport", label: "Food passport" },
    { href: "/preferences", label: "Dietary standards" },
    { href: "/leaderboard", label: "Community" },
  ],
];

export function SiteHeader({
  searchValue = "",
  hideSearch = false,
}: {
  searchValue?: string;
  hideSearch?: boolean;
} = {}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-3 px-4.5 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-5 md:px-6 md:py-4">
        <a className="hidden md:inline-flex" href="/" aria-label="halalfood.world home">
          <Logo />
        </a>
        {!hideSearch ? <HeaderSearch defaultValue={searchValue} /> : <span className="hidden md:block" />}
        <div className="hidden items-center gap-1 justify-self-end md:flex">
          <Button asChild variant="ghost" size="lg" className="rounded-full px-4 font-bold">
            <a href="/add">Add a place</a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-11 gap-2.5 rounded-full pr-1.5 pl-3.5 shadow-xs"
                aria-label="Open menu"
              >
                <HugeiconsIcon icon={Menu01Icon} size={18} strokeWidth={2.4} aria-hidden="true" />
                <span className="flex size-8 items-center justify-center rounded-full bg-muted-foreground text-background">
                  <HugeiconsIcon icon={UserCircleIcon} size={18} aria-hidden="true" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem asChild className="font-extrabold">
                <a href="/login?reason=join">Log in or sign up</a>
              </DropdownMenuItem>
              {MENU_GROUPS.map((group, index) => (
                <Fragment key={index}>
                  <DropdownMenuSeparator />
                  {group.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <a href={item.href}>{item.label}</a>
                    </DropdownMenuItem>
                  ))}
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

/** Mobile-only bottom tab bar, mirroring a stay app's Explore/Wishlists/Profile. */
export function TabBar({ active }: { active?: TabKey }) {
  const tabs: { key: TabKey; label: string; href: string; icon: typeof Compass01Icon }[] = [
    { key: "explore", label: "Explore", href: "/", icon: Compass01Icon },
    { key: "map", label: "Map", href: "/map", icon: MapsIcon },
    { key: "add", label: "Add", href: "/add", icon: Add01Icon },
    { key: "saved", label: "Saved", href: "/saved", icon: FavouriteIcon },
    { key: "community", label: "Community", href: "/leaderboard", icon: UserGroupIcon },
  ];
  return (
    <>
      {/* Keeps the last content clear of the fixed bar on small screens. */}
      <div className="h-[calc(68px+env(safe-area-inset-bottom))] md:hidden" aria-hidden="true" />
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t bg-background px-1 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] md:hidden"
        aria-label="Main"
      >
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            className={cn(
              "flex min-w-15 flex-col items-center gap-0.5 text-[11px] font-semibold text-muted-foreground",
              tab.key === active && "font-extrabold text-primary",
            )}
            aria-current={tab.key === active ? "page" : undefined}
          >
            <HugeiconsIcon icon={tab.icon} size={24} aria-hidden="true" />
            <span>{tab.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Explore",
    links: [
      { href: "/", label: "Places to eat" },
      { href: "/map", label: "Map" },
      { href: "/cities", label: "Cities" },
      { href: "/guides", label: "City guides" },
    ],
  },
  {
    title: "Community",
    links: [
      { href: "/leaderboard", label: "Community" },
      { href: "/add", label: "Add a place" },
      { href: "/contributions", label: "Your contributions" },
    ],
  },
  {
    title: "You",
    links: [
      { href: "/saved", label: "Saved places" },
      { href: "/lists", label: "Lists" },
      { href: "/passport", label: "Food passport" },
      { href: "/preferences", label: "Dietary standards" },
    ],
  },
];

export function SiteFooter({ active }: { active?: TabKey } = {}) {
  return (
    <>
      <footer className="mt-10 border-t bg-secondary">
        <div className="mx-auto max-w-7xl px-4.5 pt-10 pb-7 md:px-6">
          <div className="grid grid-cols-1 gap-4.5 md:grid-cols-4 md:gap-8">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="mb-3 text-sm">{column.title}</h2>
                {column.links.map((link) => (
                  <a key={link.href} href={link.href} className="block py-1 text-sm hover:underline">
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
            <div>
              <h2 className="mb-3 text-sm">How it works</h2>
              <p className="max-w-80 py-1 text-sm text-muted-foreground">
                Halal checks come from people who ate there, each with a name and a date.
              </p>
              <p className="max-w-80 py-1 text-sm text-muted-foreground">
                No restaurant can pay to change a status or a ranking.
              </p>
            </div>
          </div>
          <Separator className="mt-7 mb-5" />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span>© {new Date().getFullYear()} halalfood.world</span>
            <span>Place details from Google</span>
            <a href="/sitemap.xml" className="hover:underline">
              Sitemap
            </a>
          </div>
        </div>
      </footer>
      <TabBar active={active} />
    </>
  );
}

export function Breadcrumbs({
  trail,
}: {
  trail: { name: string; path: string }[];
}) {
  return (
    <Breadcrumb className="mb-3">
      <BreadcrumbList>
        {trail.map((crumb, index) => (
          <Fragment key={crumb.path}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {index === trail.length - 1 ? (
                <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.path} className="underline underline-offset-2">
                  {crumb.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function ApproximateNote({ compact = false }: { compact?: boolean }) {
  return (
    <p className={cn("text-[13px] text-muted-foreground", compact ? "mt-2" : "mt-6")}>
      {APPROXIMATE_NOTE}
    </p>
  );
}

/** A centred illustrated message for empty and error states. */
export function EmptyPanel({
  art = "eat",
  title,
  titleId,
  description,
  titleAs = "h1",
  children,
  className,
}: {
  art?: IllustrationName | null;
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  titleAs?: "h1" | "h2";
  children?: React.ReactNode;
  className?: string;
}) {
  const Title = titleAs;
  return (
    <Empty className={cn("mx-auto max-w-xl py-12", className)}>
      <EmptyHeader>
        {art && (
          <EmptyMedia>
            <Illustration name={art} size={72} />
          </EmptyMedia>
        )}
        <EmptyTitle>
          <Title id={titleId} className="text-2xl font-extrabold">
            {title}
          </Title>
        </EmptyTitle>
        {description && (
          <EmptyDescription className="text-base">{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {children && (
        <EmptyContent className="flex-row flex-wrap justify-center">{children}</EmptyContent>
      )}
    </Empty>
  );
}

export function Unavailable({ retryPath }: { retryPath: string }) {
  return (
    <EmptyPanel title="Listings are taking a moment" description="Please try again in a moment.">
      <Button asChild size="xl">
        <a href={retryPath}>Try again</a>
      </Button>
      <Button asChild size="xl" variant="outline">
        <a href="/map">Open the map</a>
      </Button>
    </EmptyPanel>
  );
}

export type ExploreTabKey = "eat" | "map" | "guides" | "community";

/** Illustrated category tabs under the header, like Homes / Experiences. */
export function ExploreTabs({ active }: { active: ExploreTabKey }) {
  const tabs: { key: ExploreTabKey; label: string; href: string; art: IllustrationName }[] = [
    { key: "eat", label: "Places to eat", href: "/", art: "eat" },
    { key: "map", label: "Map", href: "/map", art: "map" },
    { key: "guides", label: "City guides", href: "/guides", art: "shops" },
    { key: "community", label: "Community", href: "/leaderboard", art: "cup" },
  ];
  return (
    <nav
      className="-mx-4.5 mb-6 flex justify-start gap-6 overflow-x-auto border-b px-4.5 [scrollbar-width:none] md:mx-0 md:justify-center md:gap-10 md:px-0"
      aria-label="Explore"
    >
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={cn(
            "flex shrink-0 flex-col items-center gap-1 border-b-2 border-transparent pb-3 text-[13px] font-bold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            tab.key === active && "border-foreground text-foreground",
          )}
          aria-current={tab.key === active ? "page" : undefined}
        >
          <Illustration name={tab.art} size={34} />
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

export { Eyebrow, Lead } from "./section";
