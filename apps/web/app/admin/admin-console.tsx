"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@halalfood/ui/components/alert";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Input } from "@halalfood/ui/components/input";
import { Block, Loading } from "../../src/components/blocks";
import { FormMessage, InsufficientData, SectionIntro } from "../../src/components/section";

import { EVIDENCE_KIND_COPY, RELATIONSHIP_COPY, STATUS_COPY } from "@halalfood/core/halal-taxonomy";
import { REPORT_REASON_COPY } from "@halalfood/core/moderation";
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
      <Input
        aria-label={placeholder}
        value={reasons[id] ?? ""}
        placeholder={placeholder}
        onChange={(event) => setReasons((current) => ({ ...current, [id]: event.target.value }))}
      />
    );
  }

  if (state === "loading") return <Loading>Loading the queue…</Loading>;
  if (state === "denied")
    return (
      <InsufficientData>
        This console is for moderators. If you should have access, ask an admin to add your account
        to the moderators table.
      </InsufficientData>
    );
  if (state === "error" || !data)
    return <FormMessage tone="error">The console could not load.</FormMessage>;

  return (
    <div>
      {message && (
        <Alert role="status">
          <AlertDescription className="font-bold text-foreground">{message}</AlertDescription>
        </Alert>
      )}

      <Block title={<>Evidence queue ({data.evidence.length})</>}>
        <SectionIntro>
          Ordered by conflict, open reports, declared interest, expiry, claim impact and how long a
          submission has waited.
        </SectionIntro>
        {data.evidence.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.evidence.map((entry) => (
              <li key={entry.id}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold [&_a]:hover:underline">
                    <a href={`/place/${entry.placeId}`}>{entry.placeName}</a>
                    <Badge variant="secondary">priority {entry.priority}</Badge>
                  </div>
                  <p className="text-sm [&_a]:font-semibold [&_a]:hover:underline">
                    {EVIDENCE_KIND_COPY[entry.kind]} claiming{" "}
                    {STATUS_COPY[entry.claimedStatus].label} ·{" "}
                    {RELATIONSHIP_COPY[entry.relationship]}
                    {entry.incentivized ? " · rewarded" : ""}
                  </p>
                  {entry.note && (
                    <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                      {entry.note}
                    </p>
                  )}
                  <ul className="list-disc pl-4.5 text-xs text-muted-foreground">
                    {entry.rationale.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <ReasonBox
                    id={entry.id}
                    placeholder="Reason (required to reject; the contributor sees it)"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void decide("evidence", entry.id, "approved")}>
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide("evidence", entry.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={<>Factual edits ({data.edits.length})</>}>
        {data.edits.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.edits.map((edit) => {
              const id = String(edit.id);
              return (
                <li key={id}>
                  <Card size="sm" className="gap-2 px-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold [&_a]:hover:underline">
                      <a href={`/place/${String(edit.place_id)}`}>{String(edit.place_name)}</a>
                      <Badge variant="secondary">{String(edit.field)}</Badge>
                    </div>
                    <p className="text-sm [&_a]:font-semibold [&_a]:hover:underline">
                      {String(edit.current_value ?? "(empty)")} →{" "}
                      <strong>{String(edit.proposed_value)}</strong>
                    </p>
                    {edit.source_url ? (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
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
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        No source provided.
                      </p>
                    )}
                    {edit.note ? (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        {String(edit.note)}
                      </p>
                    ) : null}
                    <ReasonBox id={id} placeholder="Reason for the contributor" />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void decide("edit", id, "accepted")}>Accept</Button>
                      <Button
                        variant="secondary"
                        onClick={() => void decide("edit", id, "needs-evidence")}
                      >
                        Needs evidence
                      </Button>
                      <Button variant="outline" onClick={() => void decide("edit", id, "rejected")}>
                        Reject
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title={<>Duplicates ({data.duplicates.length})</>}>
        {data.duplicates.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.duplicates.map((report) => {
              const id = String(report.id);
              return (
                <li key={id}>
                  <Card size="sm" className="gap-2 px-4">
                    <p className="text-sm [&_a]:font-semibold [&_a]:hover:underline">
                      <a href={`/place/${String(report.place_id)}`}>{String(report.place_name)}</a>{" "}
                      duplicates{" "}
                      <a href={`/place/${String(report.duplicate_of_place_id)}`}>
                        {String(report.duplicate_of_name)}
                      </a>
                    </p>
                    {report.note ? (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        {String(report.note)}
                      </p>
                    ) : null}
                    <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                      Merging moves every visit, evidence item, photo, save and list entry onto the
                      place that is kept.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void decide("duplicate", id, "merge")}>Merge</Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title={<>Open reports ({data.reports.length})</>}>
        {data.reports.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.reports.map((report) => (
              <li key={report.id}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold [&_a]:hover:underline">
                    <span>{report.targetType}</span>
                    <Badge variant="secondary">
                      {REPORT_REASON_COPY[report.reason as keyof typeof REPORT_REASON_COPY] ??
                        report.reason}
                    </Badge>
                  </div>
                  {report.detail && (
                    <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                      {report.detail}
                    </p>
                  )}
                  <ReasonBox id={report.id} placeholder="Resolution note" />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void decide("report", report.id, "upheld")}>
                      Uphold
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide("report", report.id, "dismissed")}
                    >
                      Dismiss
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={<>Audit log</>}>
        <SectionIntro>
          Who changed halal- or ranking-sensitive data, when, why and from what source.
        </SectionIntro>
        <ul className="divide-y text-[13px]">
          {audit.map((entry) => (
            <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
              <span className="font-semibold text-muted-foreground tabular-nums">
                {new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </span>
              <span className="font-bold">{entry.action}</span>
              <span className="text-muted-foreground">
                {entry.targetType}/{entry.targetId.slice(0, 8)}
              </span>
              {entry.reason && <span className="basis-full">{entry.reason}</span>}
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}
