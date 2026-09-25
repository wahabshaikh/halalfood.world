"use client";

import { useState } from "react";
import { COVERAGE_COPY, type CityCoverage } from "../lib/coverage";

/**
 * A city's honest coverage, plus the action a visitor from a thin city needs.
 *
 * The launch assumption is that traffic arrives from everywhere at once. A
 * "coming soon" page throws that away; this shows exactly how much is indexed
 * and turns the disappointment into a demand signal and a contributor lead.
 */
export default function CityCoverageCard({
  coverage,
  headline,
}: {
  coverage: CityCoverage;
  headline: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [wantsToContribute, setWantsToContribute] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const levels = [
    { key: "indexed", count: coverage.indexed },
    { key: "enriched", count: coverage.enriched },
    { key: "intelligent", count: coverage.intelligent },
    { key: "trusted", count: coverage.trusted },
  ] as const;

  async function request() {
    setState("sending");
    try {
      const response = await fetch(
        `/api/cities/${encodeURIComponent(coverage.citySlug)}/coverage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wantsToContribute }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState("error");
        setMessage(typeof body.error === "string" ? body.error : "That did not work.");
        return;
      }
      setState("sent");
      setMessage(
        body.created === false
          ? "You have already asked for this city — it is counted."
          : wantsToContribute
            ? "Counted, and noted that you would help build it."
            : "Counted. Cities with the most requests get enriched first.",
      );
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }

  return (
    <section className="city-coverage" aria-labelledby="city-coverage-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">HOW MUCH OF THIS CITY WE ACTUALLY HAVE</p>
          <h2 id="city-coverage-title">Coverage</h2>
        </div>
      </div>

      <p className="coverage-headline">{headline}</p>

      <div
        className="coverage-bar"
        role="img"
        aria-label={`${coverage.enrichedPercent}% of listed places have attached evidence`}
      >
        <span
          className="coverage-bar-fill"
          style={{ width: `${coverage.enrichedPercent}%` }}
        />
      </div>

      <ul className="coverage-levels">
        {levels.map((level) => (
          <li key={level.key} className={`coverage-level is-${level.key}`}>
            <strong>{level.count.toLocaleString()}</strong>
            <span className="coverage-level-label">
              {COVERAGE_COPY[level.key].label}
            </span>
            <span className="coverage-level-meaning">
              {COVERAGE_COPY[level.key].meaning}
            </span>
          </li>
        ))}
      </ul>

      <div className="coverage-request">
        <label className="check-in-check">
          <input
            type="checkbox"
            checked={wantsToContribute}
            onChange={(event) => setWantsToContribute(event.target.checked)}
          />
          <span>I would help build coverage here.</span>
        </label>
        <button
          type="button"
          className="ui-button ui-button-default"
          disabled={state === "sending" || state === "sent"}
          onClick={() => void request()}
        >
          {state === "sending"
            ? "Sending…"
            : state === "sent"
              ? "Request counted"
              : "Ask for deeper coverage here"}
        </button>
        {coverage.requests > 0 && (
          <p className="coverage-requests">
            {coverage.requests.toLocaleString()}{" "}
            {coverage.requests === 1 ? "person has" : "people have"} asked for
            this city
            {coverage.contributors > 0
              ? `, ${coverage.contributors} offering to help`
              : ""}
            .
          </p>
        )}
        {message && (
          <p className={state === "error" ? "check-in-error" : "contribute-message"} role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
