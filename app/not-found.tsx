import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../src/components/site-chrome";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <header className="page-intro">
          <p className="eyebrow">404</p>
          <h1>We could not find that page</h1>
          <p className="lead">
            The place or city you asked for is not in our listings. It may have
            been removed, or the link may be mistyped.
          </p>
          <div className="detail-actions">
            <a className="action primary" href="/">
              Open the map
            </a>
            <a className="action" href="/cities">
              Browse cities
            </a>
          </div>
        </header>
      </main>
      <SiteFooter />
    </div>
  );
}
