/**
 * The fields a check-in draft may keep across a sign-in redirect.
 *
 * "Share this visit to my followers' feeds" is deliberately not one of them:
 * a restored, reopened or back-navigated form always starts unticked, so a
 * visit only reaches feeds when the diner ticks the box on the form they send.
 */
export const CHECK_IN_DRAFT_FIELDS = [
  "verdict",
  "valueVerdict",
  "serviceVerdict",
  "dishes",
  "dishDraft",
  "note",
  "spend",
  "currency",
  "context",
  "relationship",
  "incentivized",
  "shareLocation",
  "visibility",
  "check",
  "idempotencyKey",
] as const;

export type CheckInDraftField = (typeof CHECK_IN_DRAFT_FIELDS)[number];

/** Keep only the draftable fields. Anything else, sharing included, is dropped. */
export function checkInDraft(state: Record<string, unknown>): Partial<Record<CheckInDraftField, unknown>> {
  const draft: Partial<Record<CheckInDraftField, unknown>> = {};
  for (const field of CHECK_IN_DRAFT_FIELDS) if (field in state) draft[field] = state[field];
  return draft;
}
