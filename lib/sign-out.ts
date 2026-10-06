"use client";

import { authClient } from "./auth-client";
import { forgetSignedIn } from "./signed-out";

/** Every key this app keeps in the browser starts with this. */
export const LOCAL_KEY_PREFIX = "halalfood:";

/**
 * Remove everything this browser holds for the account: form drafts in
 * sessionStorage (check-in, add place, onboarding, review, profile), the
 * pending save in localStorage and the "was signed in" flag. Nothing here is
 * needed by the next person on a shared device.
 */
export function clearLocalAccountState(storages: Storage[] = browserStorages()): number {
  let removed = 0;
  for (const storage of storages) {
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(LOCAL_KEY_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        storage.removeItem(key);
        removed += 1;
      }
    } catch {
      // Storage can be off or full; there is nothing to clear then.
    }
  }
  return removed;
}

function browserStorages(): Storage[] {
  const list: Storage[] = [];
  try {
    list.push(window.sessionStorage);
  } catch {
    // Storage is unavailable (private mode, blocked cookies).
  }
  try {
    list.push(window.localStorage);
  } catch {
    // Storage is unavailable (private mode, blocked cookies).
  }
  return list;
}

export class SignOutError extends Error {
  constructor() {
    super("We couldn't sign you out. Check your connection and try again.");
    this.name = "SignOutError";
  }
}

/**
 * End the session on the server (Better Auth deletes the session row and
 * expires the cookie), then clear local drafts and flags and go home. A 401
 * means the session was already gone, which is the outcome we want. Any other
 * failure leaves everything as it was, so the person can try again.
 */
export async function signOut(
  navigate: (path: string) => void = (path) => window.location.assign(path),
): Promise<void> {
  let result: Awaited<ReturnType<typeof authClient.signOut>>;
  try {
    result = await authClient.signOut();
  } catch {
    throw new SignOutError();
  }
  const status = result.error?.status;
  if (result.error && status !== 401) throw new SignOutError();
  forgetSignedIn();
  clearLocalAccountState();
  navigate("/");
}
