/** Reports are the safety net (spec §1 rule 8). Moderators act on reports and nothing else. */
export const REPORT_TARGETS = ["place", "check", "comment", "user", "list"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const PLACE_REASONS = ["closed", "wrong-answers", "wrong-details", "duplicate", "other"] as const;
export const CONTENT_REASONS = ["harassment", "spam", "other"] as const;

export const REASON_LABEL: Record<string, string> = {
  closed: "It has closed",
  "wrong-answers": "The halal answers are wrong",
  "wrong-details": "Name, address or phone is wrong",
  duplicate: "It’s listed twice",
  harassment: "Harassment",
  spam: "Spam",
  other: "Something else",
};

export const REPORT_DETAIL_MAX = 500;

export type ReportInput = { targetType: ReportTarget; targetId: string; reason: string; detail: string | null };

export function validateReport(body: unknown): { ok: true; value: ReportInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a report." };
  const input = body as Record<string, unknown>;
  if (!(REPORT_TARGETS as readonly unknown[]).includes(input.targetType)) return { ok: false, error: "Unknown report target." };
  const targetType = input.targetType as ReportTarget;
  if (typeof input.targetId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input.targetId))
    return { ok: false, error: "Unknown report target." };
  const reasons: readonly string[] = targetType === "place" ? PLACE_REASONS : CONTENT_REASONS;
  if (typeof input.reason !== "string" || !reasons.includes(input.reason)) return { ok: false, error: "Pick a reason." };
  let detail: string | null = null;
  if (typeof input.detail === "string" && input.detail.trim()) {
    detail = input.detail.trim();
    if (detail.length > REPORT_DETAIL_MAX) return { ok: false, error: "Keep the details to 500 characters." };
  }
  return { ok: true, value: { targetType, targetId: input.targetId, reason: input.reason, detail } };
}

/** The one action a moderator takes for each reason, besides Dismiss. */
export function primaryAction(targetType: ReportTarget, reason: string): string {
  if (targetType === "place") {
    if (reason === "wrong-answers") return "reset-checks";
    if (reason === "closed") return "mark-closed";
    if (reason === "duplicate") return "merge";
    if (reason === "wrong-details") return "fix-details";
    return "hide-place";
  }
  if (targetType === "comment") return "hide-comment";
  if (targetType === "check") return "exclude-check";
  if (targetType === "user") return "suspend-user";
  return "hide-list";
}

export const ACTION_LABEL: Record<string, string> = {
  "reset-checks": "Reset checks",
  "mark-closed": "Mark closed",
  merge: "Merge",
  "fix-details": "Fix details",
  "hide-place": "Hide place",
  "hide-comment": "Remove comment",
  "exclude-check": "Exclude check",
  "suspend-user": "Suspend",
  "hide-list": "Make private",
};
