"use client";

import { useEffect, useState } from "react";
import type { ContributionRow } from "../../src/lib/contributions-repository";
import type { ReportRow } from "../../src/lib/moderation-repository";

/**
 * Contribution status with a reason attached, plus the appeal path for any
 * report that has been decided. A contributor should never have to guess what
 * happened to their submission.
 */

type Row = ContributionRow & { statusLabel?: string };

export default function ContributionsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const [contributions, reportList] = await Promise.all([
        fetch("/api/contributions"),
        fetch("/api/reports"),
      ]);
      if (contributions.status === 401) {
        const body = await contributions.json();
        if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
        return;
      }
      if (!contributions.ok) throw new Error();
      const body = await contributions.json();
      setRows(Array.isArray(body.contributions) ? body.contributions : []);
      if (reportList.ok) {
        const reportBody = await reportList.json();
        setReports(Array.isArray(reportBody.reports) ? reportBody.reports : []);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function appeal(reportId: string) {
    try {
      const response = await fetch(`/api/reports/${reportId}/appeal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: appealReason }),
      });
      const body = await response.json().catch(() => ({}));
      setMessage(
        response.ok
          ? "Appeal submitted. A different moderator will review it."
          : typeof body.error === "string"
            ? body.error
            : "Could not submit that appeal.",
      );
      setAppealFor(null);
      setAppealReason("");
      await load();
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  if (state === "loading") return <p className="map-place-status">Loading…</p>;
  if (state === "error")
    return <p className="map-place-status">Your contributions could not load.</p>;

  return (
    <div className="contributions-view">
      {message && <p className="contribute-message" role="status">{message}</p>}

      <section className="coverage-block">
        <h2>Submissions</h2>
        {rows.length === 0 ? (
          <p className="insufficient-data">Nothing submitted yet.</p>
        ) : (
          <ul className="contribution-list">
            {rows.map((row) => (
              <li key={`${row.kind}-${row.id}`} className={`contribution is-${row.status}`}>
                <div className="contribution-head">
                  <span className="contribution-kind">{row.kind}</span>
                  <a href={`/place/${row.placeId}`}>{row.placeName}</a>
                  <span className="contribution-status">
                    {row.statusLabel ?? row.status}
                  </span>
                </div>
                <p className="contribution-summary">{row.summary}</p>
                {row.statusReason && (
                  <p className="contribution-reason">{row.statusReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="coverage-block">
        <h2>Reports you filed</h2>
        {reports.length === 0 ? (
          <p className="insufficient-data">No reports filed.</p>
        ) : (
          <ul className="contribution-list">
            {reports.map((report) => (
              <li key={report.id} className={`contribution is-${report.status}`}>
                <div className="contribution-head">
                  <span className="contribution-kind">{report.targetType}</span>
                  <span className="contribution-status">{report.status}</span>
                </div>
                {report.detail && <p className="contribution-summary">{report.detail}</p>}
                {report.resolution && (
                  <p className="contribution-reason">{report.resolution}</p>
                )}
                {report.appealable && (
                  <div className="appeal-block">
                    {appealFor === report.id ? (
                      <>
                        <textarea
                          className="ui-input"
                          rows={3}
                          value={appealReason}
                          placeholder="Why should this be reconsidered?"
                          onChange={(event) => setAppealReason(event.target.value)}
                        />
                        <button
                          type="button"
                          className="ui-button ui-button-default"
                          disabled={!appealReason.trim()}
                          onClick={() => void appeal(report.id)}
                        >
                          Submit appeal
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ui-button ui-button-outline"
                        onClick={() => setAppealFor(report.id)}
                      >
                        Appeal this decision
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
