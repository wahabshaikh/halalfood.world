import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../src/components/site-chrome";
import { Illustration } from "../src/components/art";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <div className="empty-panel">
          <Illustration name="map" size={80} />
          <h1>We couldn’t find that page</h1>
          <p>The place or city may have moved, or the link might have a typo.</p>
          <div className="button-row">
            <a className="btn btn-dark" href="/">
              Start exploring
            </a>
            <a className="btn btn-line" href="/cities">
              Browse cities
            </a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
