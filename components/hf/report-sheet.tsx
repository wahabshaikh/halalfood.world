"use client";

import { useState } from "react";
import { Flag02Icon } from "@hugeicons/core-free-icons";
import { CONTENT_REASONS, PLACE_REASONS, REASON_LABEL, type ReportTarget } from "@/lib/core/moderation";
import { cn } from "@/lib/utils";
import { currentReturnPath, loginHref } from "@/lib/signed-out";
import { Icon, buttonClass } from "./kit";
import { Sheet, api, errorText, toast, useSheet } from "./kit-client";

/** Report a place, check, comment, person or list (spec §6.7). */
export function ReportButton({
  targetType,
  targetId,
  subject,
  signedIn,
  variant = "text",
  label = "Report a problem",
  className,
}: {
  targetType: ReportTarget;
  targetId: string;
  subject: string;
  signedIn: boolean;
  variant?: "text" | "icon" | "menu";
  label?: string;
  className?: string;
}) {
  const sheet = useSheet(`report-${targetType}`);
  const reasons = targetType === "place" ? PLACE_REASONS : CONTENT_REASONS;
  const [reason, setReason] = useState<string>(reasons[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/api/reports", { method: "POST", json: { targetType, targetId, reason, detail } });
      sheet.hide();
      setDetail("");
      toast("Thanks. A moderator will take a look.");
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const open = () => (signedIn ? sheet.show() : window.location.assign(loginHref(currentReturnPath())));
  return (
    <>
      {variant === "icon" ? (
        <button type="button" onClick={open} aria-label={label} className={cn("inline-flex size-11 items-center justify-center rounded-full hover:bg-secondary", className)}>
          <Icon icon={Flag02Icon} />
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          className={cn(
            variant === "menu" ? "flex min-h-11 w-full items-center gap-2 text-left text-[15px] font-bold" : "inline-flex min-h-11 w-fit items-center gap-2 text-sm font-extrabold text-subtle-foreground",
            className,
          )}
        >
          <Icon icon={Flag02Icon} size={18} />
          {label}
        </button>
      )}
      <Sheet open={sheet.open} onClose={sheet.hide} title="What’s wrong?">
        <p className="-mt-2 mb-4 text-sm font-semibold text-subtle-foreground">{subject}</p>
        <div role="radiogroup" aria-label="Reason" className="grid gap-2">
          {reasons.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={reason === value}
              onClick={() => setReason(value)}
              className={cn(
                "flex min-h-[50px] items-center gap-3 rounded-[14px] px-3.5 text-left text-[15px] font-bold",
                reason === value ? "border-2 border-foreground bg-muted" : "border border-input",
              )}
            >
              <span className={cn("size-5 shrink-0 rounded-full", reason === value ? "border-[6px] border-foreground" : "border-2 border-muted-foreground")} />
              {REASON_LABEL[value]}
            </button>
          ))}
        </div>
        <label htmlFor={`report-detail-${targetType}`} className="mt-4 mb-1.5 block text-sm font-extrabold">
          Details <span className="font-semibold text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`report-detail-${targetType}`}
          rows={2}
          maxLength={500}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder={targetType === "place" ? "e.g. They started serving beer in August" : "Anything a moderator should know"}
          className="w-full resize-none rounded-[14px] border border-input px-3.5 py-3 text-[15px]"
        />
        <button type="button" onClick={send} disabled={busy} className={buttonClass("dark", "lg", "mt-4 w-full")}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </Sheet>
    </>
  );
}
