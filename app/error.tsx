"use client";

/**
 * Client error boundary for the server-rendered pages. It deliberately shows
 * no error details — upstream failures can carry connection information.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <main className="page-main">
        <div className="empty-panel">
          <h1>Something went wrong</h1>
          <p>This page couldn’t load. Please try again in a moment.</p>
          <div className="button-row">
            <button type="button" className="btn btn-dark" onClick={reset}>
              Try again
            </button>
            <a className="btn btn-line" href="/">
              Go home
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
