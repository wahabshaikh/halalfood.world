import {
  EVIDENCE_KIND_COPY,
  EVIDENCE_SCOPE_COPY,
  RELATIONSHIP_COPY,
  STATUS_COPY,
  type HalalAssessment,
} from "@halalfood/core/halal-taxonomy";
import { Alert, AlertDescription } from "@halalfood/ui/components/alert";
import { Badge } from "@halalfood/ui/components/badge";
import { Card } from "@halalfood/ui/components/card";
import { cn } from "@halalfood/ui/lib/utils";
import { Disclosure, InsufficientData, MetaItem, SectionHeading } from "./section";
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
    <section className="my-6" aria-labelledby="evidence-panel-title">
      <SectionHeading
        id="evidence-panel-title"
        eyebrow="EVIDENCE"
        title="Why this status, and who said so"
        action={
          <Badge variant="secondary">
            {assessment.evidenceCount}{" "}
            {assessment.evidenceCount === 1 ? "item" : "items"}
          </Badge>
        }
      />

      {assessment.conflict && (
        <Alert variant="warning" className="mb-3" role="status">
          <AlertDescription>
            The items marked below contradict each other. The status stays
            Unverified and no confidence badge is shown until a moderator resolves
            the conflict.
          </AlertDescription>
        </Alert>
      )}

      {verifications.length === 0 ? (
        <InsufficientData>
          Nobody has submitted halal evidence for this branch yet. That is why
          the status reads Unverified — it is not a statement that the food is
          not halal.
        </InsufficientData>
      ) : (
        <ol className="grid gap-3">
          {verifications.map((item) => (
            <li key={item.id}>
              <Card
                size="sm"
                className={cn(
                  "gap-2.5 px-4",
                  (item.status === "pending" || item.stale) && "bg-muted/60",
                  conflicting.has(item.id) && "ring-warning",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{EVIDENCE_KIND_COPY[item.kind]}</Badge>
                  <span className="text-sm font-semibold">
                    Claims: {STATUS_COPY[item.claimedStatus].label}
                  </span>
                  {item.status === "pending" && <Badge variant="muted">Awaiting review</Badge>}
                  {item.stale && <Badge variant="muted">Expired</Badge>}
                  {conflicting.has(item.id) && <Badge variant="warning">In conflict</Badge>}
                </div>

                <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-4 gap-y-2 text-sm">
                  <MetaItem label="Scope">
                    {EVIDENCE_SCOPE_COPY[item.scope]}
                    {item.scopeNote ? ` — ${item.scopeNote}` : ""}
                  </MetaItem>
                  <MetaItem label="Captured">{date(item.capturedAt)}</MetaItem>
                  <MetaItem label="Expires">{date(item.expiresAt)}</MetaItem>
                  {item.certificationBody && (
                    <MetaItem label="Certification body">
                      {item.certificationBody}
                      {item.certificateId ? ` (${item.certificateId})` : ""}
                    </MetaItem>
                  )}
                  <MetaItem label="Submitter">
                    {RELATIONSHIP_COPY[item.relationship]}
                    {item.incentivized ? " · rewarded submission" : ""}
                  </MetaItem>
                </dl>

                {item.note && <p className="text-sm">{item.note}</p>}

                {item.evidence.length > 0 && (
                  <ul className="grid gap-1 text-sm">
                    {item.evidence.map((source) => (
                      <li key={source.url} className="truncate">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-primary underline underline-offset-2"
                        >
                          {source.kind === "link" ? source.url : source.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}

      {history.length > 0 && (
        <Disclosure className="mt-4" label={`Status history (${history.length})`}>
            <ol className="mt-2 grid gap-1.5 text-sm">
              {history.map((change) => (
                <li key={change.id}>
                  <span className="font-semibold text-muted-foreground tabular-nums">
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
        </Disclosure>
      )}
    </section>
  );
}
