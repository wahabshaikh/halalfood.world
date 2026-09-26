import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Compass01Icon, FavouriteIcon, MapsIcon, Menu01Icon, Search01Icon, UserCircleIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { APPROXIMATE_NOTE } from "../lib/seo";
import { Logo } from "./brand";
import { Illustration, type IllustrationName } from "./art";

export type TabKey = "explore" | "map" | "saved" | "community" | "add";

/** A pill search box that submits to /search, like a stay-search bar. */
export function HeaderSearch({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form className="header-search" action="/search" method="get" role="search">
      <label className="sr-only" htmlFor="header-search-input">
        Search halal places or cities
      </label>
      <input
        id="header-search-input"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Search places or cities"
        maxLength={120}
        autoComplete="off"
      />
      <button type="submit" className="header-search-button" aria-label="Search">
        <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={3} aria-hidden="true" />
      </button>
    </form>
  );
}

export function SiteHeader({
  searchValue = "",
  hideSearch = false,
}: {
  searchValue?: string;
  hideSearch?: boolean;
} = {}) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="site-logo" href="/" aria-label="halalfood.world home">
          <Logo />
        </a>
        {!hideSearch && <HeaderSearch defaultValue={searchValue} />}
        <div className="site-header-actions">
          <a className="header-link" href="/add">
            Add a place
          </a>
          <details className="header-menu">
            <summary aria-label="Open menu">
              <HugeiconsIcon icon={Menu01Icon} size={18} strokeWidth={2.4} aria-hidden="true" />
              <span className="header-avatar">
                <HugeiconsIcon icon={UserCircleIcon} size={18} aria-hidden="true" />
              </span>
            </summary>
            <nav className="header-menu-panel" aria-label="Menu">
              <a href="/login?reason=join">
                <strong>Log in or sign up</strong>
              </a>
              <hr />
              <a href="/map">Map</a>
              <a href="/cities">Cities</a>
              <a href="/guides">City guides</a>
              <a href="/add">Add a place</a>
              <hr />
              <a href="/saved">Saved</a>
              <a href="/lists">Lists</a>
              <a href="/passport">Food passport</a>
              <a href="/preferences">Dietary standards</a>
              <a href="/leaderboard">Community</a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

/** Mobile-only bottom tab bar, mirroring a stay app's Explore/Wishlists/Profile. */
export function TabBar({ active }: { active?: TabKey }) {
  const tabs: { key: TabKey; label: string; href: string; icon: React.ReactNode }[] = [
    { key: "explore", label: "Explore", href: "/", icon: <HugeiconsIcon icon={Compass01Icon} size={24} aria-hidden="true" /> },
    { key: "map", label: "Map", href: "/map", icon: <HugeiconsIcon icon={MapsIcon} size={24} aria-hidden="true" /> },
    { key: "add", label: "Add", href: "/add", icon: <HugeiconsIcon icon={Add01Icon} size={24} aria-hidden="true" /> },
    { key: "saved", label: "Saved", href: "/saved", icon: <HugeiconsIcon icon={FavouriteIcon} size={24} aria-hidden="true" /> },
    { key: "community", label: "Community", href: "/leaderboard", icon: <HugeiconsIcon icon={UserGroupIcon} size={24} aria-hidden="true" /> },
  ];
  return (
    <nav className="tab-bar" aria-label="Main">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={tab.key === active ? "is-active" : undefined}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function SiteFooter({ active }: { active?: TabKey } = {}) {
  return (
    <>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-columns">
            <div>
              <h2>Explore</h2>
              <a href="/">Places to eat</a>
              <a href="/map">Map</a>
              <a href="/cities">Cities</a>
              <a href="/guides">City guides</a>
            </div>
            <div>
              <h2>Community</h2>
              <a href="/leaderboard">Community</a>
              <a href="/add">Add a place</a>
              <a href="/contributions">Your contributions</a>
            </div>
            <div>
              <h2>You</h2>
              <a href="/saved">Saved places</a>
              <a href="/lists">Lists</a>
              <a href="/passport">Food passport</a>
              <a href="/preferences">Dietary standards</a>
            </div>
            <div>
              <h2>How it works</h2>
              <p>Halal checks come from people who ate there, each with a name and a date.</p>
              <p>No restaurant can pay to change a status or a ranking.</p>
            </div>
          </div>
          <div className="site-footer-bottom">
            <span>© {new Date().getFullYear()} halalfood.world</span>
            <span>Place details from Google</span>
            <a href="/sitemap.xml">Sitemap</a>
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
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {trail.map((crumb, index) => (
          <li key={crumb.path}>
            {index === trail.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <a href={crumb.path}>{crumb.name}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ApproximateNote({ compact = false }: { compact?: boolean }) {
  return (
    <p className={compact ? "approximate-note compact" : "approximate-note"}>{APPROXIMATE_NOTE}</p>
  );
}

export function Unavailable({ retryPath }: { retryPath: string }) {
  return (
    <div className="empty-panel">
      <Illustration name="eat" size={72} />
      <h1>Listings are taking a moment</h1>
      <p>Please try again in a moment.</p>
      <div className="button-row">
        <a className="btn btn-dark" href={retryPath}>
          Try again
        </a>
        <a className="btn btn-outline" href="/map">
          Open the map
        </a>
      </div>
    </div>
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
    <nav className="explore-top" aria-label="Explore">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={tab.key === active ? "explore-tab is-active" : "explore-tab"}
          aria-current={tab.key === active ? "page" : undefined}
        >
          <Illustration name={tab.art} size={34} />
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
