"use client";

/**
 * Client error boundary for the server-rendered pages. It deliberately shows
 * no error details — upstream failures can carry connection information.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <main className="page-main">
        <header className="page-intro">
          <p className="eyebrow">SOMETHING WENT WRONG</p>
          <h1>This page could not load</h1>
          <p className="lead">
            Listings are temporarily unavailable. Please try again in a moment.
          </p>
          <div className="detail-actions">
            <button type="button" className="action primary" onClick={reset}>
              Try again
            </button>
            <a className="action" href="/">
              Open the map
            </a>
          </div>
        </header>
      </main>
    </div>
  );
}
