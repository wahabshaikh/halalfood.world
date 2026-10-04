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

/**
 * The sheet's phase, its open session and the Share tick. `session` goes up
 * every time the sheet opens or closes, by any path, and the tick records the
 * session it was made in. A tick from an earlier session is not a tick: it is
 * unticked by construction, whatever closed the sheet, and the form is keyed
 * by the session so its DOM (and anything a browser restores into it) is new.
 */
export type CheckInSheet = {
  phase: CheckInPhase;
  session: number;
  share: { session: number; checked: boolean };
};

/** How the sheet was closed; every one of them goes through the same reset. */
export type CheckInCloseVia = "button" | "escape";

export type CheckInSheetAction =
  /** "Check in" pressed, a draft restored, or the sheet starting open. */
  | { type: "open" }
  | { type: "close"; via: CheckInCloseVia }
  | { type: "share"; checked: boolean }
  | { type: "saving" }
  /** A send that failed returns to the same open form, tick as it was. */
  | { type: "failed" }
  | { type: "done" }
  | { type: "pageshow"; persisted: boolean };

export function initialCheckInSheet(defaultOpen: boolean): CheckInSheet {
  return { phase: defaultOpen ? "open" : "idle", session: 0, share: { session: -1, checked: false } };
}

/** Whether Share is ticked in the sheet as it is now. */
export function shareTicked(state: CheckInSheet): boolean {
  return state.share.checked && state.share.session === state.session && state.phase !== "idle";
}

function nextSession(state: CheckInSheet, phase: CheckInPhase): CheckInSheet {
  return { ...state, phase, session: state.session + 1 };
}

/**
 * The check-in component stays mounted while the sheet is closed, so a tick
 * kept in plain state came back on the next open (QA AC-08a on 78c86c6, and
 * at 1280 on 4e59dc2). Every open, close, finish and back/forward restore
 * starts a new session; only a send that failed stays in the same one.
 */
export function checkInSheetReducer(state: CheckInSheet, action: CheckInSheetAction): CheckInSheet {
  switch (action.type) {
    case "open":
      return nextSession(state, "open");
    case "close":
      return nextSession(state, "idle");
    case "share":
      return state.phase === "open"
        ? { ...state, share: { session: state.session, checked: action.checked } }
        : state;
    case "saving":
      return state.phase === "open" ? { ...state, phase: "saving" } : state;
    case "failed":
      return state.phase === "saving" ? { ...state, phase: "open" } : state;
    case "done":
      return nextSession(state, "done");
    case "pageshow":
      return action.persisted ? nextSession(state, state.phase === "saving" ? "open" : state.phase) : state;
  }
}
