/**
 * Moderation and operations: the evidence review queue, reports, appeals and
 * the audit log.
 *
 * Operational tooling is part of the trust product. Every consequential change
 * to a halal claim or a ranking input is recorded with who, when, why and from
 * what source, and every decision has a documented appeal path.
 */

import type { EvidenceKind, HalalTaxonomyStatus, Relationship } from "./halal-taxonomy";

export const REPORT_TARGETS = [
  "place",
  "verification",
  "check-in",
  "photo",
  "list",
  "dish",
  "user",
] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  "factual-error",
  "fraud",
  "harassment",
  "religious-misrepresentation",
  "incentivized",
  "duplicate",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_COPY: Record<ReportReason, string> = {
  "factual-error": "Factual error",
  fraud: "Fraud or fake evidence",
  harassment: "Harassment",
  "religious-misrepresentation": "Religious misrepresentation",
  incentivized: "Rewarded or incentivized feedback",
  duplicate: "Duplicate entry",
  other: "Something else",
};

export const REPORT_STATUSES = [
  "open",
  "upheld",
  "dismissed",
  "appealed",
  "appeal-upheld",
  "appeal-dismissed",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type ReportValidation =
  | {
      ok: true;
      data: { targetType: ReportTarget; targetId: string; reason: ReportReason; detail: string | null };
    }
  | { ok: false; error: string };

export function validateReport(input: unknown): ReportValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  if (!(REPORT_TARGETS as readonly unknown[]).includes(body.targetType))
    return { ok: false, error: "Choose what you are reporting." };
  if (typeof body.targetId !== "string" || !body.targetId.trim() || body.targetId.length > 100)
    return { ok: false, error: "The reported item is missing." };
  if (!(REPORT_REASONS as readonly unknown[]).includes(body.reason))
    return { ok: false, error: "Choose a reason for the report." };

  let detail: string | null = null;
  if (body.detail !== undefined && body.detail !== null && body.detail !== "") {
    if (typeof body.detail !== "string" || body.detail.trim().length > 2000)
      return { ok: false, error: "The detail must be 2000 characters or fewer." };
    detail = body.detail.trim() || null;
  }
  if ((body.reason === "other" || body.reason === "harassment") && !detail)
    return { ok: false, error: "Tell us what happened so the report can be reviewed." };

  return {
    ok: true,
    data: {
      targetType: body.targetType as ReportTarget,
      targetId: body.targetId.trim(),
      reason: body.reason as ReportReason,
      detail,
    },
  };
}

export type AppealValidation =
  | { ok: true; data: { reason: string } }
  | { ok: false; error: string };

export function validateAppeal(input: unknown): AppealValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;
  if (typeof body.reason !== "string")
    return { ok: false, error: "Explain why the decision should be reconsidered." };
  const reason = body.reason.trim();
  if (!reason || reason.length > 2000)
    return { ok: false, error: "The appeal must be 1-2000 characters." };
  return { ok: true, data: { reason } };
}

/** A decision can only be appealed once it has actually been decided. */
export function canAppeal(status: ReportStatus): boolean {
  return status === "upheld" || status === "dismissed";
}

/* ------------------------------------------------------- the review queue -- */

export type QueueItem = {
  id: string;
  placeId: string;
  kind: EvidenceKind;
  claimedStatus: HalalTaxonomyStatus;
  relationship: Relationship;
  incentivized: boolean;
  createdAt: number;
  /** Effective expiry of the evidence this submission would replace or extend. */
  expiresAt: number | null;
  /** Whether the place already has contradictory current evidence. */
  conflicting: boolean;
  /** How many people have this place saved — a proxy for blast radius. */
  savedCount: number;
  openReports: number;
};

export type PrioritizedQueueItem = QueueItem & {
  priority: number;
  /** Why this sits where it does, shown in the console. */
  rationale: string[];
};

const DAY_MS = 86_400_000;

/**
 * Prioritise expiring, conflicting, high-impact and suspicious claims. The
 * score is deliberately explainable: each contribution is listed alongside it.
 */
export function prioritizeQueue(
  items: readonly QueueItem[],
  now: number = Date.now(),
): PrioritizedQueueItem[] {
  return items
    .map((item) => {
      let priority = 0;
      const rationale: string[] = [];

      if (item.conflicting) {
        priority += 100;
        rationale.push("Conflicts with current evidence");
      }
      if (item.openReports > 0) {
        priority += 40 + Math.min(item.openReports, 5) * 10;
        rationale.push(`${item.openReports} open report${item.openReports === 1 ? "" : "s"}`);
      }
      if (item.incentivized || item.relationship !== "none") {
        priority += 35;
        rationale.push("Declared interest or reward");
      }
      if (item.expiresAt !== null) {
        const daysLeft = Math.floor((item.expiresAt - now) / DAY_MS);
        if (daysLeft <= 0) {
          priority += 60;
          rationale.push("Replaces expired evidence");
        } else if (daysLeft <= 30) {
          priority += 30;
          rationale.push(`Evidence expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
        }
      }
      if (item.claimedStatus === "verified" || item.claimedStatus === "not-halal") {
        priority += 25;
        rationale.push("High-impact claim");
      }
      const impact = Math.min(Math.floor(item.savedCount / 10), 20);
      if (impact) {
        priority += impact;
        rationale.push(`Saved by ${item.savedCount} people`);
      }
      const waitingDays = Math.floor((now - item.createdAt) / DAY_MS);
      if (waitingDays > 0) {
        priority += Math.min(waitingDays, 20);
        rationale.push(`Waiting ${waitingDays} day${waitingDays === 1 ? "" : "s"}`);
      }
      if (!rationale.length) rationale.push("Routine submission");

      return { ...item, priority, rationale };
    })
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

/* ---------------------------------------------------------------- audit -- */

export const AUDIT_ACTIONS = [
  "evidence.submitted",
  "evidence.approved",
  "evidence.rejected",
  "evidence.superseded",
  "status.changed",
  "edit.submitted",
  "edit.accepted",
  "edit.rejected",
  "dish.added",
  "duplicate.reported",
  "duplicate.merged",
  "report.opened",
  "report.resolved",
  "appeal.opened",
  "appeal.resolved",
  "facts.updated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  actorUserId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  reason?: string | null;
  source?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Ranking- and halal-sensitive actions must always be recorded. */
export const ALWAYS_AUDITED: ReadonlySet<AuditAction> = new Set([
  "evidence.approved",
  "evidence.rejected",
  "evidence.superseded",
  "status.changed",
  "edit.accepted",
  "edit.rejected",
  "duplicate.merged",
  "report.resolved",
  "appeal.resolved",
  "facts.updated",
]);

export function requiresAudit(action: AuditAction): boolean {
  return ALWAYS_AUDITED.has(action);
}

/** Serialise an audit payload without letting one huge blob into the table. */
export function auditValue(value: unknown, maxLength = 4000): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") return null;
    return json.length > maxLength ? json.slice(0, maxLength) : json;
  } catch {
    return null;
  }
}
