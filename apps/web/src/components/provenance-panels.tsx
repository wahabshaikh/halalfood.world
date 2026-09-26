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
import { Badge } from "@halalfood/ui/components/badge";
import { Card } from "@halalfood/ui/components/card";
import { cn } from "@halalfood/ui/lib/utils";
import {
  DividedList,
  Disclosure,
  InsufficientData,
  MetaItem,
  Note,
  SectionHeading,
  SectionIntro,
} from "./section";

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
    <div className="my-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-muted px-3.5 py-2.5 text-sm">
      <Badge variant={level === "trusted" ? "success" : level === "indexed" ? "muted" : "info"}>
        {copy.label}
      </Badge>
      <span className="text-muted-foreground">{copy.meaning}</span>
      {computedAt ? (
        <span className="text-xs text-muted-foreground">Assessed {day(computedAt)}</span>
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
    <section className="my-6" aria-labelledby="provenance-title">
      <Card className="gap-0 px-5 py-5">
      <SectionHeading
        id="provenance-title"
        eyebrow="WHERE THESE FACTS CAME FROM"
        title="Sources and dates"
      />
      <SectionIntro>
        Each fact below is stored with the source that asserted it and the date
        it was observed. A newer reading is appended rather than overwriting the
        old one, so the history stays inspectable.
      </SectionIntro>
      <DividedList>
        {facts.map((fact) => (
          <li key={fact.predicate} className={cn("grid gap-1 py-3", fact.stale && "opacity-80")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{fact.predicate}</span>
              <span className="text-sm">{fact.value}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{SOURCE_CLASS_COPY[fact.sourceClass]}</span>
              <span>{fact.source}</span>
              <span>{formatObservedAge(fact.observedAt, now)}</span>
              {fact.stale && <Badge variant="warning">Needs revalidation</Badge>}
              {fact.sourceUrl && (
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-primary underline underline-offset-2"
                >
                  Source
                </a>
              )}
            </div>
            {fact.disagreeing.length > 0 && (
              <p className="text-[13px] text-warning-foreground">
                {fact.disagreeing.length}{" "}
                {fact.disagreeing.length === 1 ? "source disagrees" : "sources disagree"}:{" "}
                {fact.disagreeing
                  .map((item) => `${item.value} (${item.source}, ${day(item.observedAt)})`)
                  .join("; ")}
                . Both readings are kept until the conflict is resolved.
              </p>
            )}
            {fact.history.length > 1 && (
              <Disclosure label={`History (${fact.history.length})`}>
                <ol className="grid gap-1 text-[13px]">
                  {fact.history.map((item) => (
                    <li key={item.id}>
                      {day(item.observedAt)} — {item.value}{" "}
                      <span className="text-muted-foreground">({item.source})</span>
                    </li>
                  ))}
                </ol>
              </Disclosure>
            )}
          </li>
        ))}
      </DividedList>
      </Card>
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
    <section className="my-6" aria-labelledby="inspection-title">
      <Card className="gap-0 px-5 py-5">
      <SectionHeading id="inspection-title" eyebrow="OFFICIAL RECORDS" title="Hygiene and licensing" />
      <SectionIntro>
        These come from the relevant food-safety authority, not from diners.
        They are shown separately and never folded into any rating on this page.
      </SectionIntro>
      {inspections.length === 0 ? (
        <InsufficientData>
          No official hygiene or licence record has been matched to this place
          yet. That is a gap in our data, not a finding about the restaurant.
        </InsufficientData>
      ) : (
        <DividedList>
          {inspections.map((record) => (
            <li key={record.id} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{record.authority}</strong>
                <Badge variant="outline" className="capitalize">
                  {record.kind}
                </Badge>
              </div>
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-4 gap-y-2 text-sm">
                {record.grade && <MetaItem label="Grade">{record.grade}</MetaItem>}
                {record.score !== null && <MetaItem label="Score">{record.score}</MetaItem>}
                {record.licenceStatus && (
                  <MetaItem label="Licence">{record.licenceStatus}</MetaItem>
                )}
                <MetaItem label="Inspected">{day(record.inspectedAt)}</MetaItem>
                <MetaItem label="Retrieved">{day(record.retrievedAt)}</MetaItem>
              </dl>
              {record.matchConfidence !== "high" && (
                <Note>
                  Matched to this restaurant with {record.matchConfidence}{" "}
                  confidence — the authority record may belong to a different
                  outlet with a similar name or address.
                </Note>
              )}
              {record.sourceUrl && (
                <a
                  className="text-sm font-semibold text-primary underline underline-offset-2"
                  href={record.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Open the official record
                </a>
              )}
            </li>
          ))}
        </DividedList>
      )}
      </Card>
    </section>
  );
}

/** Service shown as its own dimension, beside value rather than inside it. */
export function ServicePanel({ checkIns }: { checkIns: CheckInSummary }) {
  const { service } = checkIns;
  if (!service.rated) return null;
  return (
    <p className="mt-2 text-sm">
      Service, rated separately by {service.rated}{" "}
      {service.rated === 1 ? "diner" : "diners"}: {service.good}{" "}
      {SERVICE_COPY.good.toLowerCase()} · {service.fine} fine · {service.poor}{" "}
      {SERVICE_COPY.poor.toLowerCase()}
    </p>
  );
}
