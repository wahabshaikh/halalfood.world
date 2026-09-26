import {
  COVERAGE_COPY,
  type CoverageLevel,
} from "@halalfood/core/coverage";
import {
  SOURCE_CLASS_COPY,
  formatObservedAge,
  type ObservedFact,
} from "@halalfood/core/observations";
import type { PlaceInspection } from "../lib/observations-repository";
import { SERVICE_COPY, type CheckInSummary } from "@halalfood/core/check-in";

/**
 * The panels that make provenance visible.
 *
 * Three product rules show up as markup here: every published fact is shown
 * with its source and the date it was observed; official inspection records sit
 * in their own panel and are never mixed into a diner-derived figure; and a
 * place states honestly how much of it is actually covered.
 */

function day(value: number | null): string {
  if (value === null) return "undated";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "undated";
}

export function CoverageBadge({
  level,
  computedAt,
}: {
  level: CoverageLevel;
  computedAt?: number | null;
}) {
  const copy = COVERAGE_COPY[level];
  return (
    <div className={`coverage-badge is-${level}`}>
      <span className="coverage-badge-label">{copy.label}</span>
      <span className="coverage-badge-meaning">{copy.meaning}</span>
      {computedAt ? (
        <span className="coverage-badge-date">Assessed {day(computedAt)}</span>
      ) : null}
    </div>
  );
}

/** Every published fact with the source and date behind it. */
export function ProvenancePanel({
  facts,
  now,
}: {
  facts: ObservedFact[];
  now: number;
}) {
  if (!facts.length) return null;
  return (
    <section className="provenance-panel" aria-labelledby="provenance-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">WHERE THESE FACTS CAME FROM</p>
          <h2 id="provenance-title">Sources and dates</h2>
        </div>
      </div>
      <p className="section-intro">
        Each fact below is stored with the source that asserted it and the date
        it was observed. A newer reading is appended rather than overwriting the
        old one, so the history stays inspectable.
      </p>
      <ul className="provenance-list">
        {facts.map((fact) => (
          <li key={fact.predicate} className={fact.stale ? "is-stale" : undefined}>
            <div className="provenance-head">
              <span className="provenance-predicate">{fact.predicate}</span>
              <span className="provenance-value">{fact.value}</span>
            </div>
            <div className="provenance-meta">
              <span>{SOURCE_CLASS_COPY[fact.sourceClass]}</span>
              <span>{fact.source}</span>
              <span>{formatObservedAge(fact.observedAt, now)}</span>
              {fact.stale && <span className="provenance-stale">Needs revalidation</span>}
              {fact.sourceUrl && (
                <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                  Source
                </a>
              )}
            </div>
            {fact.disagreeing.length > 0 && (
              <p className="provenance-disagreement">
                {fact.disagreeing.length}{" "}
                {fact.disagreeing.length === 1 ? "source disagrees" : "sources disagree"}:{" "}
                {fact.disagreeing
                  .map((item) => `${item.value} (${item.source}, ${day(item.observedAt)})`)
                  .join("; ")}
                . Both readings are kept until the conflict is resolved.
              </p>
            )}
            {fact.history.length > 1 && (
              <details className="provenance-history">
                <summary>History ({fact.history.length})</summary>
                <ol>
                  {fact.history.map((item) => (
                    <li key={item.id}>
                      {day(item.observedAt)} — {item.value}{" "}
                      <span className="provenance-history-source">({item.source})</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Official hygiene and licence records. Kept in their own panel because an
 * audit answers a different question from a diner's opinion, and blending the
 * two would misrepresent both.
 */
export function InspectionPanel({
  inspections,
}: {
  inspections: PlaceInspection[];
}) {
  return (
    <section className="inspection-panel" aria-labelledby="inspection-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">OFFICIAL RECORDS</p>
          <h2 id="inspection-title">Hygiene and licensing</h2>
        </div>
      </div>
      <p className="section-intro">
        These come from the relevant food-safety authority, not from diners.
        They are shown separately and never folded into any rating on this page.
      </p>
      {inspections.length === 0 ? (
        <p className="insufficient-data">
          No official hygiene or licence record has been matched to this place
          yet. That is a gap in our data, not a finding about the restaurant.
        </p>
      ) : (
        <ul className="inspection-list">
          {inspections.map((record) => (
            <li key={record.id} className={`inspection-item is-${record.kind}`}>
              <div className="inspection-head">
                <strong>{record.authority}</strong>
                <span className="inspection-kind">{record.kind}</span>
              </div>
              <dl className="inspection-meta">
                {record.grade && (
                  <div>
                    <dt>Grade</dt>
                    <dd>{record.grade}</dd>
                  </div>
                )}
                {record.score !== null && (
                  <div>
                    <dt>Score</dt>
                    <dd>{record.score}</dd>
                  </div>
                )}
                {record.licenceStatus && (
                  <div>
                    <dt>Licence</dt>
                    <dd>{record.licenceStatus}</dd>
                  </div>
                )}
                <div>
                  <dt>Inspected</dt>
                  <dd>{day(record.inspectedAt)}</dd>
                </div>
                <div>
                  <dt>Retrieved</dt>
                  <dd>{day(record.retrievedAt)}</dd>
                </div>
              </dl>
              {record.matchConfidence !== "high" && (
                <p className="inspection-match">
                  Matched to this restaurant with {record.matchConfidence}{" "}
                  confidence — the authority record may belong to a different
                  outlet with a similar name or address.
                </p>
              )}
              {record.sourceUrl && (
                <a
                  className="inspection-source"
                  href={record.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Open the official record
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Service shown as its own dimension, beside value rather than inside it. */
export function ServicePanel({ checkIns }: { checkIns: CheckInSummary }) {
  const { service } = checkIns;
  if (!service.rated) return null;
  return (
    <p className="service-breakdown">
      Service, rated separately by {service.rated}{" "}
      {service.rated === 1 ? "diner" : "diners"}: {service.good}{" "}
      {SERVICE_COPY.good.toLowerCase()} · {service.fine} fine · {service.poor}{" "}
      {SERVICE_COPY.poor.toLowerCase()}
    </p>
  );
}
