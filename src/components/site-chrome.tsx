import { ArrowLeft, Bookmark, MapPinned, Plus, Trophy, UserRound } from "lucide-react";
import { APPROXIMATE_NOTE, SITE_NAME } from "../lib/seo";

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path
          d="M14 25.2s7.6-7.2 7.6-13.1A7.6 7.6 0 1 0 6.4 12.1C6.4 18 14 25.2 14 25.2Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle cx="14" cy="11.8" r="3.1" stroke="currentColor" strokeWidth="1.7" />
        <path d="M10.3 11.8h7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function SiteHeader({ backTo }: { backTo?: { href: string; label: string } }) {
  return (
    <header className="page-header">
      <div className="page-header-inner">
        <a className="page-brand" href="/" aria-label="Halalfood home">
          <BrandMark />
          <span className="brand-word">{SITE_NAME}</span>
        </a>
        <nav className="page-nav" aria-label="Primary">
          <a className="page-nav-link" href="/">
            <MapPinned size={16} aria-hidden="true" />
            Explore
          </a>
          <a className="page-nav-link" href="/cities">
            Cities
          </a>
          <a className="page-nav-link" href="/leaderboard">
            <Trophy size={16} aria-hidden="true" />
            Community
          </a>
          <a className="page-nav-link" href="/saved">
            <Bookmark size={16} aria-hidden="true" />
            Saved
          </a>
          <a className="page-nav-link" href="/lists">
            Lists
          </a>
          <a className="page-nav-link" href="/passport">
            Passport
          </a>
          {backTo && (
            <a className="page-nav-link page-nav-back" href={backTo.href}>
              <ArrowLeft size={16} aria-hidden="true" />
              {backTo.label}
            </a>
          )}
        </nav>
        <div className="page-header-actions">
          <a className="header-contribute" href="/add">
            <Plus size={16} aria-hidden="true" />
            Contribute
          </a>
          <a className="header-signin" href="/login" aria-label="Sign in">
            <UserRound size={18} aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="page-footer">
      <div className="page-footer-inner">
        <div className="page-footer-brand">
          <a className="page-brand" href="/">
            <BrandMark />
            <span className="brand-word">{SITE_NAME}</span>
          </a>
          <p>Find it. Share it. Keep the community moving.</p>
        </div>
        <nav className="page-footer-links" aria-label="Footer">
          <a href="/">Explore</a>
          <a href="/cities">Cities</a>
          <a href="/leaderboard">Community</a>
          <a href="/add">Add a place</a>
          <a href="/lists">Lists</a>
          <a href="/passport">Food passport</a>
          <a href="/preferences">Dietary standards</a>
          <a href="/contributions">Your contributions</a>
          <a href="/sitemap.xml">Sitemap</a>
        </nav>
        <div className="page-footer-note">
          <p>{APPROXIMATE_NOTE}</p>
          <p>Listings come from public directories and community submissions. Confirm details before visiting.</p>
          <p>
            Unverified never means not halal. Halal status is shown with its
            evidence, scope and date, and no restaurant can pay to change a
            status, a ranking or a search result.
          </p>
        </div>
      </div>
    </footer>
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
    <p className={compact ? "approximate-note compact" : "approximate-note"}>
      <span className="approximate-note-icon" aria-hidden="true">◎</span>
      <span>{APPROXIMATE_NOTE}</span>
    </p>
  );
}

export function Unavailable({ retryPath }: { retryPath: string }) {
  return (
    <div className="unavailable-card">
      <span className="unavailable-mark" aria-hidden="true">—</span>
      <p className="eyebrow">TEMPORARILY UNAVAILABLE</p>
      <h1>Listings are taking a moment</h1>
      <p className="lead">
        The map is still here. Please try again in a moment to load the directory.
      </p>
      <div className="detail-actions">
        <a className="action primary" href={retryPath}>Try again</a>
        <a className="action" href="/">Open the map</a>
      </div>
    </div>
  );
}