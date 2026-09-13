import { APPROXIMATE_NOTE, SITE_NAME } from "../lib/seo";

/** Brand mark used in the header of every server-rendered page. */
function BrandMark() {
  return (
    <span className="brand-icon" aria-hidden="true">
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18M18 3c-3 3-3 8 0 8h2M20 3v18" />
      </svg>
    </span>
  );
}

export function SiteHeader({ backTo }: { backTo?: { href: string; label: string } }) {
  return (
    <header className="page-header">
      <a className="page-brand" href="/">
        <BrandMark />
        <span>{SITE_NAME}</span>
      </a>
      <nav aria-label="Primary">
        <a href="/">Map</a>
        <a href="/cities">Cities</a>
        {backTo && <a href={backTo.href}>{backTo.label}</a>}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="page-footer">
      <p>{APPROXIMATE_NOTE}</p>
      <p>
        <a href="/">Open the map</a> · <a href="/cities">All cities</a> ·{" "}
        <a href="/sitemap.xml">Sitemap</a>
      </p>
      <p className="page-footer-meta">
        Halal listings only. Data is collected from public directories and may be
        out of date — always check with the restaurant.
      </p>
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
      <span aria-hidden="true">◎</span> {APPROXIMATE_NOTE}
    </p>
  );
}

/** Shown in place of listings when the data store is unreachable. */
export function Unavailable({ retryPath }: { retryPath: string }) {
  return (
    <div className="page-intro">
      <p className="eyebrow">TEMPORARILY UNAVAILABLE</p>
      <h1>Listings are not loading right now</h1>
      <p className="lead">
        This is on our side and is usually brief. Please try again in a moment.
      </p>
      <div className="detail-actions">
        <a className="action primary" href={retryPath}>
          Try again
        </a>
        <a className="action" href="/">
          Open the map
        </a>
      </div>
    </div>
  );
}
