/**
 * How recognitions and changes read on the page. Expiry is computed here, at render time, from the
 * official list's own `valid_until` date: we never store or overstate it.
 */
import type { ChangeKind, RecognitionStatus } from "./diff";
import { scopeLabel } from "./scopes";

export type DisplayStatus = "recognised" | "expired" | "suspended" | "removed" | "pending";

/** Today in UTC as an ISO date, the form `valid_until` uses. */
export function isoToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The status to show: a recognised body whose official date has passed shows as expired. */
export function displayStatus(status: RecognitionStatus, validUntil: string | null, today: string): DisplayStatus {
  if (status === "recognised" && validUntil && validUntil < today) return "expired";
  return status;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  recognised: "Recognised",
  expired: "Expired",
  suspended: "Suspended",
  removed: "No longer listed",
  pending: "Pending",
};

export const NO_DATE_LABEL = "No date on official list";

/** "2030-06-30" -> "30 Jun 2030". */
export function formatIsoDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Epoch ms -> "17 Oct 2026". */
export function formatDay(at: number | null): string | null {
  return at ? formatIsoDate(new Date(at).toISOString().slice(0, 10)) : null;
}

/** What the valid-until cell says. */
export function validUntilText(validUntil: string | null, today: string): string {
  const date = formatIsoDate(validUntil);
  if (!date) return NO_DATE_LABEL;
  return validUntil! < today ? `Expired ${date} (official list's own date)` : date;
}

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  scope_added: "Scope added",
  scope_removed: "Scope removed",
  date_changed: "Date changed",
  renamed: "Renamed",
  expired: "Expired",
  status_changed: "Status changed",
};

function list(value: unknown): string {
  return Array.isArray(value) ? value.map((code) => scopeLabel(String(code))).join(", ") : "";
}

/** One plain sentence for a change, from its stored before/after. */
export function changeSentence(
  kind: ChangeKind,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  authorityName: string,
): string {
  switch (kind) {
    case "added":
      return `Added to ${authorityName}'s list.`;
    case "removed":
      return `No longer on ${authorityName}'s list.`;
    case "scope_added":
      return `Scope added: ${list(after?.added)}.`;
    case "scope_removed":
      return `Scope removed: ${list(after?.removed)}.`;
    case "date_changed": {
      const from = formatIsoDate((before?.validUntil as string | null) ?? null) ?? NO_DATE_LABEL.toLowerCase();
      const to = formatIsoDate((after?.validUntil as string | null) ?? null) ?? NO_DATE_LABEL.toLowerCase();
      return `Valid until changed from ${from} to ${to}.`;
    }
    case "renamed":
      return `Renamed from “${String(before?.name ?? "")}” to “${String(after?.name ?? "")}”.`;
    default:
      return `${CHANGE_LABEL[kind]}.`;
  }
}

export function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
