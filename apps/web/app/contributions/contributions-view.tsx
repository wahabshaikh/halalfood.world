"use client";

import { useEffect, useState } from "react";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Textarea } from "@halalfood/ui/components/textarea";
import { Block, Loading } from "../../src/components/blocks";
import { FormMessage, InsufficientData, Note } from "../../src/components/section";

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

  if (state === "loading") return <Loading>Loading…</Loading>;
  if (state === "error")
    return <FormMessage tone="error">Your contributions could not load.</FormMessage>;

  return (
    <div>
      {message && <FormMessage tone="success">{message}</FormMessage>}

      <Block title="Submissions">
        {rows.length === 0 ? (
          <InsufficientData>Nothing submitted yet.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {rows.map((row) => (
              <li key={`${row.kind}-${row.id}`}>
                <Contribution
                  kind={row.kind}
                  status={row.status}
                  statusLabel={row.statusLabel ?? row.status}
                  title={
                    <a href={`/place/${row.placeId}`} className="font-semibold hover:underline">
                      {row.placeName}
                    </a>
                  }
                  summary={row.summary}
                  reason={row.statusReason}
                />
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Reports you filed">
        {reports.length === 0 ? (
          <InsufficientData>No reports filed.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {reports.map((report) => (
              <li key={report.id}>
                <Contribution
                  kind={report.targetType}
                  status={report.status}
                  statusLabel={report.status}
                  summary={report.detail}
                  reason={report.resolution}
                >
                  {report.appealable && (
                    <div className="mt-2 grid gap-2">
                      {appealFor === report.id ? (
                        <>
                          <Textarea
                            aria-label="Why should this be reconsidered?"
                            rows={3}
                            value={appealReason}
                            placeholder="Why should this be reconsidered?"
                            onChange={(event) => setAppealReason(event.target.value)}
                          />
                          <Button
                            className="justify-self-start"
                            disabled={!appealReason.trim()}
                            onClick={() => void appeal(report.id)}
                          >
                            Submit appeal
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          className="justify-self-start"
                          onClick={() => setAppealFor(report.id)}
                        >
                          Appeal this decision
                        </Button>
                      )}
                    </div>
                  )}
                </Contribution>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

function statusVariant(status: string) {
  if (/accept|approv|resolved|upheld/.test(status)) return "success" as const;
  if (/reject|dismiss/.test(status)) return "destructive" as const;
  if (/pending|open|evidence|review/.test(status)) return "warning" as const;
  return "muted" as const;
}

function Contribution({
  kind,
  status,
  statusLabel,
  title,
  summary,
  reason,
  children,
}: {
  kind: string;
  status: string;
  statusLabel: string;
  title?: React.ReactNode;
  summary?: string | null;
  reason?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-1.5 px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="capitalize">
          {kind}
        </Badge>
        {title}
        <Badge variant={statusVariant(status)} className="ml-auto capitalize">
          {statusLabel}
        </Badge>
      </div>
      {summary && <p className="text-sm">{summary}</p>}
      {reason && <Note>{reason}</Note>}
      {children}
    </Card>
  );
}
