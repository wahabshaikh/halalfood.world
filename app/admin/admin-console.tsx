"use client";

import { useEffect, useState } from "react";
import {
  EVIDENCE_KIND_COPY,
  RELATIONSHIP_COPY,
  STATUS_COPY,
} from "../../src/lib/halal-taxonomy";
import { REPORT_REASON_COPY } from "../../src/lib/moderation";
import type { QueueEntry } from "../../src/lib/moderation-repository";
import type { ReportRow } from "../../src/lib/moderation-repository";

/**
 * The moderation console.
 *
 * The evidence queue is ordered by an explainable priority score and every row
 * shows the reasons for its position, so a moderator can see why a submission
 * is at the top rather than trusting an opaque ranking. Every decision writes
 * an audit entry, and a rejection is required to carry a reason the
 * contributor can read.
 */

type Payload = {
  role: string;
  evidence: QueueEntry[];
  edits: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  reports: ReportRow[];
};

type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: number;
};

export default function AdminConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/admin/queue");
      if (response.status === 401) {
        const body = await response.json();
        if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
        return;
      }
      if (response.status === 403) {
        setState("denied");
        return;
      }
      if (!response.ok) throw new Error();
      setData((await response.json()) as Payload);
      const auditResponse = await fetch("/api/admin/audit?limit=40");
      if (auditResponse.ok) {
        const body = await auditResponse.json();
        setAudit(Array.isArray(body.entries) ? body.entries : []);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function decide(kind: string, id: string, decision: string) {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/review/${kind}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: reasons[id] ?? "" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "That decision failed.");
        return;
      }
      setMessage("Recorded, and written to the audit log.");
      await load();
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  function ReasonBox({ id, placeholder }: { id: string; placeholder: string }) {
    return (
      <input
        className="ui-input"
        value={reasons[id] ?? ""}
        placeholder={placeholder}
        onChange={(event) =>
          setReasons((current) => ({ ...current, [id]: event.target.value }))
        }
      />
    );
  }

  if (state === "loading") return <p className="map-place-status">Loading the queue…</p>;
  if (state === "denied")
    return (
      <p className="insufficient-data">
        This console is for moderators. If you should have access, ask an admin
        to add your account to the moderators table.
      </p>
    );
  if (state === "error" || !data)
    return <p className="map-place-status">The console could not load.</p>;

  return (
    <div className="admin-console">
      {message && <p className="contribute-message" role="status">{message}</p>}

      <section className="coverage-block">
        <h2>Evidence queue ({data.evidence.length})</h2>
        <p className="section-intro">
          Ordered by conflict, open reports, declared interest, expiry, claim
          impact and how long a submission has waited.
        </p>
        {data.evidence.length === 0 ? (
          <p className="insufficient-data">Nothing waiting.</p>
        ) : (
          <ul className="queue-list">
            {data.evidence.map((entry) => (
              <li key={entry.id} className="queue-item">
                <div className="queue-head">
                  <a href={`/place/${entry.placeId}`}>{entry.placeName}</a>
                  <span className="queue-priority">priority {entry.priority}</span>
                </div>
                <p className="queue-claim">
                  {EVIDENCE_KIND_COPY[entry.kind]} claiming{" "}
                  {STATUS_COPY[entry.claimedStatus].label} ·{" "}
                  {RELATIONSHIP_COPY[entry.relationship]}
                  {entry.incentivized ? " · rewarded" : ""}
                </p>
                {entry.note && <p className="queue-note">{entry.note}</p>}
                <ul className="queue-rationale">
                  {entry.rationale.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <ReasonBox
                  id={entry.id}
                  placeholder="Reason (required to reject; the contributor sees it)"
                />
                <div className="queue-actions">
                  <button
                    type="button"
                    className="ui-button ui-button-default"
                    onClick={() => void decide("evidence", entry.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button-outline"
                    onClick={() => void decide("evidence", entry.id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="coverage-block">
        <h2>Factual edits ({data.edits.length})</h2>
        {data.edits.length === 0 ? (
          <p className="insufficient-data">Nothing waiting.</p>
        ) : (
          <ul className="queue-list">
            {data.edits.map((edit) => {
              const id = String(edit.id);
              return (
                <li key={id} className="queue-item">
                  <div className="queue-head">
                    <a href={`/place/${String(edit.place_id)}`}>
                      {String(edit.place_name)}
                    </a>
                    <span className="queue-priority">{String(edit.field)}</span>
                  </div>
                  <p className="queue-claim">
                    {String(edit.current_value ?? "(empty)")} →{" "}
                    <strong>{String(edit.proposed_value)}</strong>
                  </p>
                  {edit.source_url ? (
                    <p className="queue-note">
                      Source:{" "}
                      <a
                        href={String(edit.source_url)}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        {String(edit.source_url)}
                      </a>
                    </p>
                  ) : (
                    <p className="queue-note">No source provided.</p>
                  )}
                  {edit.note ? (
                    <p className="queue-note">{String(edit.note)}</p>
                  ) : null}
                  <ReasonBox id={id} placeholder="Reason for the contributor" />
                  <div className="queue-actions">
                    <button
                      type="button"
                      className="ui-button ui-button-default"
                      onClick={() => void decide("edit", id, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="ui-button ui-button-secondary"
                      onClick={() => void decide("edit", id, "needs-evidence")}
                    >
                      Needs evidence
                    </button>
                    <button
                      type="button"
                      className="ui-button ui-button-outline"
                      onClick={() => void decide("edit", id, "rejected")}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="coverage-block">
        <h2>Duplicates ({data.duplicates.length})</h2>
        {data.duplicates.length === 0 ? (
          <p className="insufficient-data">Nothing waiting.</p>
        ) : (
          <ul className="queue-list">
            {data.duplicates.map((report) => {
              const id = String(report.id);
              return (
                <li key={id} className="queue-item">
                  <p className="queue-claim">
                    <a href={`/place/${String(report.place_id)}`}>
                      {String(report.place_name)}
                    </a>{" "}
                    duplicates{" "}
                    <a href={`/place/${String(report.duplicate_of_place_id)}`}>
                      {String(report.duplicate_of_name)}
                    </a>
                  </p>
                  {report.note ? (
                    <p className="queue-note">{String(report.note)}</p>
                  ) : null}
                  <p className="queue-note">
                    Merging moves every visit, evidence item, photo, save and
                    list entry onto the place that is kept.
                  </p>
                  <div className="queue-actions">
                    <button
                      type="button"
                      className="ui-button ui-button-default"
                      onClick={() => void decide("duplicate", id, "merge")}
                    >
                      Merge
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="coverage-block">
        <h2>Open reports ({data.reports.length})</h2>
        {data.reports.length === 0 ? (
          <p className="insufficient-data">Nothing waiting.</p>
        ) : (
          <ul className="queue-list">
            {data.reports.map((report) => (
              <li key={report.id} className="queue-item">
                <div className="queue-head">
                  <span>{report.targetType}</span>
                  <span className="queue-priority">
                    {REPORT_REASON_COPY[
                      report.reason as keyof typeof REPORT_REASON_COPY
                    ] ?? report.reason}
                  </span>
                </div>
                {report.detail && <p className="queue-note">{report.detail}</p>}
                <ReasonBox id={report.id} placeholder="Resolution note" />
                <div className="queue-actions">
                  <button
                    type="button"
                    className="ui-button ui-button-default"
                    onClick={() => void decide("report", report.id, "upheld")}
                  >
                    Uphold
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button-outline"
                    onClick={() => void decide("report", report.id, "dismissed")}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="coverage-block">
        <h2>Audit log</h2>
        <p className="section-intro">
          Who changed halal- or ranking-sensitive data, when, why and from what
          source.
        </p>
        <ul className="audit-list">
          {audit.map((entry) => (
            <li key={entry.id}>
              <span className="audit-time">
                {new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </span>
              <span className="audit-action">{entry.action}</span>
              <span className="audit-target">
                {entry.targetType}/{entry.targetId.slice(0, 8)}
              </span>
              {entry.reason && <span className="audit-reason">{entry.reason}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
