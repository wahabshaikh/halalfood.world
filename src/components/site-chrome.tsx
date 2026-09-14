import { ArrowLeft, Bookmark, MapPinned, Plus, Trophy, UserRound } from "lucide-react";
import { APPROXIMATE_NOTE, SITE_NAME } from "../lib/seo";

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img className="brand-logo-image" src="/halalfood-world-logo.png" alt="" />
    </span>
  );
}

export function SiteHeader({ backTo }: { backTo?: { href: string; label: string } }) {
  return (
    <header className="page-header">
      <div className="page-header-inner">
        <a className="page-brand" href="/" aria-label="halalfood.world home">
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
          <a href="/sitemap.xml">Sitemap</a>
        </nav>
        <div className="page-footer-note">
          <p>{APPROXIMATE_NOTE}</p>
          <p>Listings come from public directories and community submissions. Confirm details before visiting.</p>
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