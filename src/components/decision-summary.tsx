import {
  CONFIDENCE_COPY,
  EVIDENCE_SCOPE_COPY,
  STATUS_COPY,
  type HalalAssessment,
} from "../lib/halal-taxonomy";
import { displayFacts, type PlaceFacts } from "../lib/place-facts";
import {
  MIN_PUBLISHABLE_SAMPLE,
  VALUE_COPY,
  type CheckInSummary,
  type DishHighlights,
  type ReturnIntentBucket,
} from "../lib/check-in";
import type { Suitability } from "../lib/user-preferences";

/**
 * The decision summary, server-rendered so it is crawlable and readable
 * without JavaScript.
 *
 * Three rules are visible in the markup rather than only in the data layer:
 * the status badge always sits next to its evidence date and scope; a
 * percentage is replaced by counts and an explicit insufficient-data state
 * below the sample floor; and verified and unverified experience are shown as
 * two separate rows, never averaged.
 */

function formatMoney(minor: number | null, currency: string | null): string | null {
  if (minor === null || !currency) return null;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`;
  }
}

function ReturnIntent({
  bucket,
  label,
  description,
}: {
  bucket: ReturnIntentBucket;
  label: string;
  description: string;
}) {
  return (
    <div className="return-intent-row">
      <div className="return-intent-head">
        <strong>{label}</strong>
        <span className="return-intent-count">
          {bucket.count} {bucket.count === 1 ? "check-in" : "check-ins"}
        </span>
      </div>
      {bucket.insufficientData ? (
        <p className="insufficient-data">
          {bucket.count === 0
            ? "No check-ins yet."
            : `Not enough check-ins to publish a percentage — ${MIN_PUBLISHABLE_SAMPLE} are needed. ${bucket.definitely} said definitely, ${bucket.maybe} maybe, ${bucket.no} no.`}
        </p>
      ) : (
        <>
          <p className="return-intent-value">
            <strong>{bucket.wouldReturnPercent}%</strong> would definitely return
          </p>
          <p className="return-intent-breakdown">
            {bucket.definitely} definitely · {bucket.maybe} maybe · {bucket.no} no
          </p>
        </>
      )}
      <p className="return-intent-description">{description}</p>
    </div>
  );
}

export function DecisionHeadline({
  assessment,
  headline,
  evidenceLine,
  suitability,
}: {
  assessment: HalalAssessment;
  headline: string;
  evidenceLine: string;
  suitability: Suitability | null;
}) {
  const copy = STATUS_COPY[assessment.status];
  return (
    <section
      className={`decision-summary tone-${copy.tone}`}
      aria-labelledby="decision-summary-title"
    >
      <div className="decision-status">
        <span className="ui-badge decision-badge">{copy.label}</span>
        {assessment.confidence !== "none" && (
          <span className="decision-confidence">
            {CONFIDENCE_COPY[assessment.confidence]}
          </span>
        )}
        {assessment.conflict && (
          <span className="decision-flag">Conflicting evidence — under review</span>
        )}
        {assessment.needsReverification && !assessment.conflict && (
          <span className="decision-flag">Re-verification needed</span>
        )}
      </div>
      <h2 id="decision-summary-title" className="decision-headline">
        {headline}
      </h2>
      <p className="decision-evidence-line">{evidenceLine}</p>

      {suitability && (
        <div
          className={`suitability ${suitability.meets ? "is-met" : "is-blocked"}`}
          aria-live="polite"
        >
          <p className="suitability-verdict">
            {suitability.meets
              ? "This meets the dietary standards saved on your account."
              : "This does not meet the dietary standards saved on your account."}
          </p>
          {suitability.blockers.length > 0 && (
            <ul className="suitability-list">
              {suitability.blockers.map((note) => (
                <li key={note.code}>{note.message}</li>
              ))}
            </ul>
          )}
          {suitability.warnings.length > 0 && (
            <ul className="suitability-list is-warning">
              {suitability.warnings.map((note) => (
                <li key={note.code}>{note.message}</li>
              ))}
            </ul>
          )}
          <p className="suitability-note">
            <a href="/preferences">Change your dietary standards</a>
          </p>
        </div>
      )}

      <ul className="decision-reasons">
        {assessment.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}

export function FactChips({ facts }: { facts: PlaceFacts }) {
  const entries = displayFacts(facts);
  return (
    <section className="fact-panel" aria-labelledby="fact-panel-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">THE FACTS, SEPARATELY</p>
          <h2 id="fact-panel-title">Alcohol, pork, kitchen, ownership</h2>
        </div>
      </div>
      <p className="section-intro">
        These are recorded as independent facts, not folded into one badge. An
        unknown answer means nobody has recorded it yet.
      </p>
      <ul className="fact-chips">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`fact-chip is-${entry.value}${entry.reassuring ? " is-reassuring" : ""}`}
          >
            {/* The state is in the text as well as the colour, for
                colour-independent reading. */}
            <span className="fact-chip-label">{entry.label}</span>
          </li>
        ))}
      </ul>
      {facts.certificationBody && (
        <p className="fact-certification">
          Certification body on file: <strong>{facts.certificationBody}</strong>
        </p>
      )}
      {facts.branchLabel && (
        <p className="fact-branch">
          Branch: <strong>{facts.branchLabel}</strong>. Evidence is recorded per
          branch and never copied between locations.
        </p>
      )}
    </section>
  );
}

export function DishHighlightPanel({ dishes }: { dishes: DishHighlights }) {
  if (dishes.insufficientData && !dishes.mostOrdered.length)
    return (
      <section className="dish-panel" aria-labelledby="dish-panel-title">
        <div className="place-section-heading">
          <div>
            <p className="eyebrow">DISHES</p>
            <h2 id="dish-panel-title">What to order</h2>
          </div>
        </div>
        <p className="insufficient-data">
          No dish verdicts yet. Record a visit and say what you ordered to start
          this off.
        </p>
      </section>
    );

  const groups = [
    { key: "ordered", title: "Most ordered", items: dishes.mostOrdered },
    { key: "recommended", title: "Most recommended", items: dishes.mostRecommended },
    { key: "avoided", title: "Commonly avoided", items: dishes.commonlyAvoided },
  ].filter((group) => group.items.length);

  return (
    <section className="dish-panel" aria-labelledby="dish-panel-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">DISHES</p>
          <h2 id="dish-panel-title">What to order</h2>
        </div>
      </div>
      <div className="dish-groups">
        {groups.map((group) => (
          <div key={group.key} className={`dish-group is-${group.key}`}>
            <h3>{group.title}</h3>
            <ul>
              {group.items.map((dish) => (
                <li key={dish.normalizedName}>
                  <span className="dish-name">{dish.name}</span>
                  <span className="dish-meta">
                    {dish.orderAgainPercent === null
                      ? `${dish.orders} ${dish.orders === 1 ? "verdict" : "verdicts"} — too few to rate`
                      : `${dish.orderAgainPercent}% would order again · ${dish.orders} verdicts`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReturnIntentPanel({ checkIns }: { checkIns: CheckInSummary }) {
  const spend = formatMoney(checkIns.medianSpendMinor, checkIns.currency);
  const valueTotal =
    checkIns.value.great + checkIns.value.fair + checkIns.value.overpriced;
  return (
    <section className="return-intent-panel" aria-labelledby="return-intent-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">WOULD DINERS RETURN</p>
          <h2 id="return-intent-title">Return intent, not stars</h2>
        </div>
      </div>
      <p className="section-intro">
        There are no star ratings here. Diners answer one question — would you
        come back — and verified visits are kept apart from unverified ones.
      </p>
      <div className="return-intent-grid">
        <ReturnIntent
          bucket={checkIns.verified}
          label="Verified visits"
          description="Confirmed by device location at the venue or an uploaded receipt."
        />
        <ReturnIntent
          bucket={checkIns.unverified}
          label="Unverified visits"
          description="Recorded by diners without independent proof."
        />
      </div>
      {valueTotal > 0 && (
        <p className="value-breakdown">
          Value: {checkIns.value.great} {VALUE_COPY.great.toLowerCase()} ·{" "}
          {checkIns.value.fair} fair · {checkIns.value.overpriced} overpriced
          {spend ? ` · typically ${spend} per person` : ""}
        </p>
      )}
      {checkIns.excludedCount > 0 && (
        <p className="excluded-note">
          {checkIns.excludedCount} {checkIns.excludedCount === 1 ? "check-in is" : "check-ins are"}{" "}
          excluded from these figures because the diner disclosed a reward or a
          relationship with the restaurant.
        </p>
      )}
    </section>
  );
}

export function ScopeNote({ assessment }: { assessment: HalalAssessment }) {
  if (!assessment.scopes.length) return null;
  return (
    <p className="scope-note">
      Scope of the supporting evidence:{" "}
      {assessment.scopes.map((scope) => EVIDENCE_SCOPE_COPY[scope]).join(", ")}.
    </p>
  );
}
