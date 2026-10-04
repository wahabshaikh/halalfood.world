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
