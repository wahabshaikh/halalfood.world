/** Shown when an action comes back 401 for someone who was signed in. */
export const SIGNED_OUT_COPY = "You've been signed out. Sign in again.";

/** Shown when an action needs an account and the visitor never signed in here. */
export function signInCopyFor(returnTo: string): string {
  if (returnTo.startsWith("/add")) return "Sign in to add a place.";
  if (returnTo.startsWith("/place/")) return "Sign in to do that on this place.";
  if (returnTo.startsWith("/map")) return "Sign in to see your places and your friends’ places.";
  if (returnTo.startsWith("/settings")) return "Sign in to change your settings.";
  return "Sign in to continue.";
}

/**
 * Set in this browser whenever the session lookup finds a user, and removed on
 * sign out. Only for choosing copy: "You've been signed out" for someone who
 * was signed in, "Sign in to …" for someone who never was. Never for access.
 */
export const WAS_SIGNED_IN_KEY = "halalfood:was-signed-in";

export function rememberSignedIn(): void {
  try {
    window.localStorage.setItem(WAS_SIGNED_IN_KEY, "1");
  } catch {
    // Storage can be off; the copy falls back to "Sign in to …".
  }
}

export function forgetSignedIn(): void {
  try {
    window.localStorage.removeItem(WAS_SIGNED_IN_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/** Whether this browser had a session before. False on the server. */
export function wasSignedIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WAS_SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether a request carried a Better Auth session cookie, valid or not. */
export function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=[^;\s]/.test(cookie);
}

function safePath(returnTo: string): string {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\")
    ? returnTo
    : "/";
}

/**
 * Login URL that brings the person back to the page they were on.
 * `returnTo` must be a same-origin path. Anything else goes home.
 * `reason=signed-out` only when there was a session to lose; otherwise
 * `reason=sign-in`, so the login page asks rather than says "signed out".
 */
export function signedOutLoginPath(returnTo: string, hadSession: boolean = wasSignedIn()): string {
  const path = safePath(returnTo);
  return `/login?reason=${hadSession ? "signed-out" : "sign-in"}&returnTo=${encodeURIComponent(path)}`;
}

/** The page the browser is on, including the query string. */
export function currentReturnPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}
