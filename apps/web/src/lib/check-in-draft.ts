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

export type CheckInPhase = "idle" | "open" | "saving" | "done";

/** The sheet's phase and its Share tick, which only the open sheet may set. */
export type CheckInSheet = { phase: CheckInPhase; shareToFeed: boolean };

export type CheckInSheetAction =
  /** "Check in" pressed, a draft restored, or the sheet starting open. */
  | { type: "open" }
  | { type: "close" }
  | { type: "share"; checked: boolean }
  | { type: "saving" }
  /** A send that failed returns to the same open form, tick as it was. */
  | { type: "failed" }
  | { type: "done" }
  | { type: "pageshow"; persisted: boolean };

export function initialCheckInSheet(defaultOpen: boolean): CheckInSheet {
  return { phase: defaultOpen ? "open" : "idle", shareToFeed: false };
}

/**
 * The check-in component stays mounted while the sheet is closed, so a tick
 * kept in plain state came back on the next open (QA AC-08a on 78c86c6).
 * Every open and close starts Share unticked; only a send that failed keeps it.
 */
export function checkInSheetReducer(state: CheckInSheet, action: CheckInSheetAction): CheckInSheet {
  switch (action.type) {
    case "open":
      return { phase: "open", shareToFeed: false };
    case "close":
      return { phase: "idle", shareToFeed: false };
    case "share":
      return state.phase === "open" ? { ...state, shareToFeed: action.checked } : state;
    case "saving":
      return { ...state, phase: "saving" };
    case "failed":
      return { ...state, phase: "open" };
    case "done":
      return { phase: "done", shareToFeed: false };
    case "pageshow":
      return action.persisted ? { ...state, shareToFeed: false } : state;
  }
}
