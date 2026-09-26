import {
  EVIDENCE_KIND_COPY,
  EVIDENCE_SCOPE_COPY,
  RELATIONSHIP_COPY,
  STATUS_COPY,
  type HalalAssessment,
} from "@halalfood/core/halal-taxonomy";
import type { PublicHalalVerification } from "../lib/halal-verifications";
import type { StatusChange } from "../lib/place-decision";

/**
 * The audit surface for one halal claim: every source, its scope, its dates,
 * the contributor's declared relationship, and the history of status changes.
 *
 * Nothing here is summarised away — this is the page a careful person opens
 * when the decision matters, so it shows the conflicting items too.
 */

function date(value: string | null): string {
  if (!value) return "undated";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "undated";
  return parsed.toISOString().slice(0, 10);
}

export default function EvidencePanel({
  assessment,
  verifications,
  history,
}: {
  assessment: HalalAssessment;
  verifications: PublicHalalVerification[];
  history: StatusChange[];
}) {
  const conflicting = new Set([
    ...(assessment.conflict?.positiveEvidenceIds ?? []),
    ...(assessment.conflict?.negativeEvidenceIds ?? []),
  ]);

  return (
    <section className="evidence-panel" aria-labelledby="evidence-panel-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">EVIDENCE</p>
          <h2 id="evidence-panel-title">Why this status, and who said so</h2>
        </div>
        <span className="verification-count">
          {assessment.evidenceCount}{" "}
          {assessment.evidenceCount === 1 ? "item" : "items"}
        </span>
      </div>

      {assessment.conflict && (
        <p className="evidence-conflict" role="status">
          The items marked below contradict each other. The status stays
          Unverified and no confidence badge is shown until a moderator resolves
          the conflict.
        </p>
      )}

      {verifications.length === 0 ? (
        <p className="insufficient-data">
          Nobody has submitted halal evidence for this branch yet. That is why
          the status reads Unverified — it is not a statement that the food is
          not halal.
        </p>
      ) : (
        <ol className="evidence-list">
          {verifications.map((item) => (
            <li
              key={item.id}
              className={`evidence-item is-${item.status}${item.stale ? " is-stale" : ""}${conflicting.has(item.id) ? " is-conflicting" : ""}`}
            >
              <div className="evidence-item-head">
                <span className="ui-badge evidence-kind">
                  {EVIDENCE_KIND_COPY[item.kind]}
                </span>
                <span className="evidence-claim">
                  Claims: {STATUS_COPY[item.claimedStatus].label}
                </span>
                {item.status === "pending" && (
                  <span className="evidence-state">Awaiting review</span>
                )}
                {item.stale && <span className="evidence-state">Expired</span>}
                {conflicting.has(item.id) && (
                  <span className="evidence-state is-conflict">In conflict</span>
                )}
              </div>

              <dl className="evidence-meta">
                <div>
                  <dt>Scope</dt>
                  <dd>
                    {EVIDENCE_SCOPE_COPY[item.scope]}
                    {item.scopeNote ? ` — ${item.scopeNote}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{date(item.capturedAt)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{date(item.expiresAt)}</dd>
                </div>
                {item.certificationBody && (
                  <div>
                    <dt>Certification body</dt>
                    <dd>
                      {item.certificationBody}
                      {item.certificateId ? ` (${item.certificateId})` : ""}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Submitter</dt>
                  <dd>
                    {RELATIONSHIP_COPY[item.relationship]}
                    {item.incentivized ? " · rewarded submission" : ""}
                  </dd>
                </div>
              </dl>

              {item.note && <p className="evidence-note">{item.note}</p>}

              {item.evidence.length > 0 && (
                <ul className="evidence-sources">
                  {item.evidence.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        {source.kind === "link" ? source.url : source.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {history.length > 0 && (
        <details className="evidence-history">
          <summary>Status history ({history.length})</summary>
          <ol>
            {history.map((change) => (
              <li key={change.id}>
                <span className="history-date">
                  {new Date(change.createdAt).toISOString().slice(0, 10)}
                </span>{" "}
                {change.previousStatus
                  ? `${STATUS_COPY[change.previousStatus as keyof typeof STATUS_COPY]?.label ?? change.previousStatus} → `
                  : "Set to "}
                {STATUS_COPY[change.nextStatus as keyof typeof STATUS_COPY]?.label ??
                  change.nextStatus}
                {change.reason ? ` — ${change.reason}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
