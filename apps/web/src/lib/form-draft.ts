type DraftStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserStore(): DraftStore | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Keep an in-progress form across the sign-in redirect. */
export function saveFormDraft(key: string, value: unknown, store: DraftStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // The form still works if storage is full or blocked.
  }
}

export function readFormDraft(key: string, store: DraftStore | null = browserStore()): unknown {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function clearFormDraft(key: string, store: DraftStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function draftRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * "Share this visit to my followers' feeds" is opt-in. A restored check-in
 * draft turns it on only when the draft says the diner ticked it, and the
 * visit was public. Older drafts without that record stay off.
 */
export function restoredShareToFeed(draft: Record<string, unknown> | null): boolean {
  if (!draft) return false;
  return (
    draft.shareToFeed === true &&
    draft.shareToFeedChosen === true &&
    draft.visibility !== "private"
  );
}
