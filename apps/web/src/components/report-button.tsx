"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Textarea } from "@halalfood/ui/components/textarea";
import {
  REPORT_REASON_COPY,
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
} from "@halalfood/core/moderation";
import { SelectField } from "./form-fields";
import { FormMessage } from "./section";
import { loginHref, currentReturnPath } from "../lib/signed-out";

function goToLogin(reason = "report") {
  window.location.assign(loginHref(currentReturnPath(), reason));
}

/**
 * Report a visit or a comment into the existing moderation queue. Reports go
 * to the same review, appeal and audit path as any other contribution.
 */
export function ReportButton({
  targetType,
  targetId,
  label = "Report",
  idPrefix,
  onSent,
}: {
  targetType: ReportTarget;
  targetId: string;
  label?: string;
  idPrefix: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent")
    return <span className="text-[13px] text-muted-foreground">Reported. Thank you.</span>;

  async function send() {
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          detail: detail.trim() || undefined,
        }),
      });
      if (response.status === 401) {
        goToLogin("report");
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Could not send that report.");
        setState("idle");
        return;
      }
      setState("sent");
      onSent?.();
    } catch {
      setError("Could not reach the server. Please try again.");
      setState("idle");
    }
  }

  if (!open)
    return (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-[13px] text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );

  return (
    <div className="grid gap-2.5 rounded-xl border p-3.5">
      <SelectField
        id={`${idPrefix}-reason`}
        label="What is wrong?"
        value={reason}
        onValueChange={setReason}
        options={REPORT_REASONS.map((value) => ({
          value,
          label: REPORT_REASON_COPY[value],
        }))}
      />
      <Textarea
        aria-label="Details"
        rows={2}
        maxLength={2000}
        value={detail}
        placeholder="Tell the moderators what happened (required for harassment and other)."
        onChange={(event) => setDetail(event.target.value)}
      />
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex gap-2">
        <Button size="sm" disabled={state === "sending"} onClick={send}>
          {state === "sending" ? "Sending…" : "Send report"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
