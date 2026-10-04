"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import type { ReportTarget } from "@halalfood/core/moderation";
import {
  presentHttpFailure,
  presentTransportFailure,
} from "../lib/failure-copy";
import { ReportButton } from "./report-button";

function goToLogin() {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?reason=confirm&returnTo=${encodeURIComponent(here)}`);
}

/**
 * Confirm or report someone else's public halal check or check-in.
 * Counts stay visible when the viewer filed the target themselves.
 */
export function CommunityChain({
  targetType,
  targetId,
  own,
  confirmCount,
  reportCount,
  viewerConfirmed,
  reportLabel = "Report",
}: {
  targetType: Extract<ReportTarget, "verification" | "check-in">;
  targetId: string;
  own: boolean;
  confirmCount: number;
  reportCount: number;
  viewerConfirmed: boolean;
  reportLabel?: string;
}) {
  const [confirms, setConfirms] = useState(confirmCount);
  const [confirmed, setConfirmed] = useState(viewerConfirmed);
  const [reports, setReports] = useState(reportCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/confirmations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ targetType, targetId }),
      });
      if (response.status === 401) {
        goToLogin();
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        confirmCount?: number;
      } | null;
      if (!response.ok) {
        setError(
          presentHttpFailure(
            "this confirmation",
            response.status,
            typeof payload?.error === "string" ? payload.error : null,
          ).message,
        );
        return;
      }
      setConfirmed(true);
      setConfirms(
        typeof payload?.confirmCount === "number" ? payload.confirmCount : confirms + 1,
      );
    } catch (caught) {
      setError(presentTransportFailure("this confirmation", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
      <span>
        {confirms} {confirms === 1 ? "confirmation" : "confirmations"}
      </span>
      <span>
        {reports} {reports === 1 ? "report" : "reports"}
      </span>
      {!own && (
        <>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-[13px] font-bold"
            disabled={busy || confirmed}
            onClick={() => void confirm()}
          >
            {confirmed ? "Confirmed" : busy ? "Confirming…" : "Confirm"}
          </Button>
          <ReportButton
            targetType={targetType}
            targetId={targetId}
            label={reportLabel}
            idPrefix={`report-${targetType}-${targetId}`}
            onSent={() => setReports((count) => count + 1)}
          />
        </>
      )}
      {error && <span className="basis-full text-destructive">{error}</span>}
    </div>
  );
}
