import {
  CONFIDENCE_COPY,
  EVIDENCE_SCOPE_COPY,
  STATUS_COPY,
  type HalalAssessment,
} from "@halalfood/core/halal-taxonomy";
import { displayFacts, type PlaceFacts } from "@halalfood/core/place-facts";
import {
  MIN_PUBLISHABLE_SAMPLE,
  VALUE_COPY,
  type CheckInSummary,
  type DishHighlights,
  type ReturnIntentBucket,
} from "@halalfood/core/check-in";
import type { Suitability } from "@halalfood/core/user-preferences";
import { Alert, AlertDescription, AlertTitle } from "@halalfood/ui/components/alert";
import { Badge } from "@halalfood/ui/components/badge";
import { Card } from "@halalfood/ui/components/card";
import { cn } from "@halalfood/ui/lib/utils";
import {
  DividedList,
  InsufficientData,
  Note,
  SectionHeading,
  SectionIntro,
} from "./section";
import { TONE_BADGE, TONE_BORDER } from "./status-tone";

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
    <div className="grid gap-1 rounded-xl border bg-muted p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <strong>{label}</strong>
        <span className="text-[13px] text-muted-foreground">
          {bucket.count} {bucket.count === 1 ? "check-in" : "check-ins"}
        </span>
      </div>
      {bucket.insufficientData ? (
        <InsufficientData>
          {bucket.count === 0
            ? "No check-ins yet."
            : `Not enough check-ins to publish a percentage — ${MIN_PUBLISHABLE_SAMPLE} are needed. ${bucket.definitely} said definitely, ${bucket.maybe} maybe, ${bucket.no} no.`}
        </InsufficientData>
      ) : (
        <>
          <p>
            <strong className="text-2xl tracking-tight">{bucket.wouldReturnPercent}%</strong>{" "}
            would definitely return
          </p>
          <p className="text-[13px] text-muted-foreground">
            {bucket.definitely} definitely · {bucket.maybe} maybe · {bucket.no} no
          </p>
        </>
      )}
      <Note>{description}</Note>
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
    <section aria-labelledby="decision-summary-title" className="mt-5 mb-2">
      <Card className={cn("gap-0 border-l-4 px-5 py-5 shadow-xs", TONE_BORDER[copy.tone])}>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <Badge variant={TONE_BADGE[copy.tone]} className="h-6 px-2.5 text-[13px] font-bold">
            {copy.label}
          </Badge>
          {assessment.confidence !== "none" && (
            <span className="text-[13px] font-semibold text-muted-foreground">
              {CONFIDENCE_COPY[assessment.confidence]}
            </span>
          )}
          {assessment.conflict && (
            <Badge variant="warning">Conflicting evidence — under review</Badge>
          )}
          {assessment.needsReverification && !assessment.conflict && (
            <Badge variant="warning">Re-verification needed</Badge>
          )}
        </div>
        <h2 id="decision-summary-title" className="mb-1.5 text-[19px] leading-snug">
          {headline}
        </h2>
        <p className="text-sm text-muted-foreground">{evidenceLine}</p>

        {suitability && <SuitabilityNotice suitability={suitability} className="mt-3.5" />}

        <ul className="mt-3.5 grid list-disc gap-1.5 pl-4.5 text-sm text-muted-foreground">
          {assessment.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** Whether this place meets the visitor's saved dietary standards, and why not. */
export function SuitabilityNotice({
  suitability,
  className,
}: {
  suitability: Suitability;
  className?: string;
}) {
  return (
    <Alert
      variant={suitability.meets ? "success" : "destructive"}
      className={cn("px-4 py-3.5", !suitability.meets && "bg-destructive/5", className)}
      aria-live="polite"
    >
      <AlertTitle className="font-semibold">
        {suitability.meets
          ? "This meets the dietary standards saved on your account."
          : "This does not meet the dietary standards saved on your account."}
      </AlertTitle>
      <AlertDescription className="text-foreground">
        {suitability.blockers.length > 0 && (
          <ul className="list-disc pl-4.5">
            {suitability.blockers.map((note) => (
              <li key={note.code}>{note.message}</li>
            ))}
          </ul>
        )}
        {suitability.warnings.length > 0 && (
          <ul className="list-disc pl-4.5 text-warning-foreground">
            {suitability.warnings.map((note) => (
              <li key={note.code}>{note.message}</li>
            ))}
          </ul>
        )}
        <a href="/preferences" className="font-semibold underline underline-offset-2">
          Change your dietary standards
        </a>
      </AlertDescription>
    </Alert>
  );
}

export function FactChips({ facts }: { facts: PlaceFacts }) {
  const entries = displayFacts(facts);
  return (
    <section className="my-6" aria-labelledby="fact-panel-title">
      <SectionHeading
        id="fact-panel-title"
        eyebrow="THE FACTS, SEPARATELY"
        title="Alcohol, pork, kitchen, ownership"
      />
      <SectionIntro>
        These are recorded as independent facts, not folded into one badge. An
        unknown answer means nobody has recorded it yet.
      </SectionIntro>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <li key={entry.key}>
            {/* The state is in the text as well as the colour, for
                colour-independent reading. */}
            <Badge
              variant={
                entry.reassuring
                  ? "success"
                  : entry.value === "yes" || entry.value === "no"
                    ? "warning"
                    : "muted"
              }
              className="h-8 border-border px-3 text-[13px] font-medium"
            >
              {entry.label}
            </Badge>
          </li>
        ))}
      </ul>
      {facts.certificationBody && (
        <p className="mt-3 text-sm">
          Certification body on file: <strong>{facts.certificationBody}</strong>
        </p>
      )}
      {facts.branchLabel && (
        <p className="mt-2 text-sm">
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
      <section className="my-6" aria-labelledby="dish-panel-title">
        <SectionHeading id="dish-panel-title" eyebrow="DISHES" title="What to order" />
        <InsufficientData>
          No dish verdicts yet. Record a visit and say what you ordered to start
          this off.
        </InsufficientData>
      </section>
    );

  const groups = [
    { key: "ordered", title: "Most ordered", items: dishes.mostOrdered },
    { key: "recommended", title: "Most recommended", items: dishes.mostRecommended },
    { key: "avoided", title: "Commonly avoided", items: dishes.commonlyAvoided },
  ].filter((group) => group.items.length);

  return (
    <section className="my-6" aria-labelledby="dish-panel-title">
      <SectionHeading id="dish-panel-title" eyebrow="DISHES" title="What to order" />
      <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 text-sm tracking-widest text-muted-foreground uppercase">
              {group.title}
            </h3>
            <DividedList>
              {group.items.map((dish) => (
                <li key={dish.normalizedName} className="py-2">
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      group.key === "avoided" && "text-destructive",
                    )}
                  >
                    {dish.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {dish.orderAgainPercent === null
                      ? `${dish.orders} ${dish.orders === 1 ? "verdict" : "verdicts"} — too few to rate`
                      : `${dish.orderAgainPercent}% would order again · ${dish.orders} verdicts`}
                  </span>
                </li>
              ))}
            </DividedList>
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
    <section className="my-6" aria-labelledby="return-intent-title">
      <SectionHeading
        id="return-intent-title"
        eyebrow="WOULD DINERS RETURN"
        title="Return intent, not stars"
      />
      <SectionIntro>
        There are no star ratings here. Diners answer one question — would you
        come back — and verified visits are kept apart from unverified ones.
      </SectionIntro>
      <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
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
        <p className="mt-3 text-sm">
          Value: {checkIns.value.great} {VALUE_COPY.great.toLowerCase()} ·{" "}
          {checkIns.value.fair} fair · {checkIns.value.overpriced} overpriced
          {spend ? ` · typically ${spend} per person` : ""}
        </p>
      )}
      {checkIns.excludedCount > 0 && (
        <Note className="mt-2">
          {checkIns.excludedCount} {checkIns.excludedCount === 1 ? "check-in is" : "check-ins are"}{" "}
          excluded from these figures because the diner disclosed a reward or a
          relationship with the restaurant.
        </Note>
      )}
    </section>
  );
}

export function ScopeNote({ assessment }: { assessment: HalalAssessment }) {
  if (!assessment.scopes.length) return null;
  return (
    <Note className="mt-2">
      Scope of the supporting evidence:{" "}
      {assessment.scopes.map((scope) => EVIDENCE_SCOPE_COPY[scope]).join(", ")}.
    </Note>
  );
}
