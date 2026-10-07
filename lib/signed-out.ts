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

const PROBE_ORIGIN = "https://return-to.invalid";

/**
 * A same-origin path with its query, or `fallback`. Rejects other origins,
 * protocol-relative `//host`, backslashes and control characters (a browser
 * drops tabs and newlines, so "/\t/evil.example" would become "//evil.example").
 */
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return fallback;
  try {
    if (new URL(path, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return fallback;
  } catch {
    return fallback;
  }
  return path;
}

/**
 * The return path with the page's query kept. Callers often pass the bare
 * route ("/place/…", "/settings"); when the browser is on that route, its query
 * string (city, filters, the open place) is part of where the person was.
 */
function withCurrentQuery(path: string): string {
  if (typeof window === "undefined" || path.includes("?") || path.includes("#")) return path;
  const { pathname, search } = window.location;
  return pathname === path ? pathname + search : path;
}

/** `/login?reason=…&returnTo=…`, with returnTo a safely encoded same-origin path plus query. */
export function loginHref(returnTo: string, reason?: string | null): string {
  const path = withCurrentQuery(safeReturnPath(returnTo));
  const query = new URLSearchParams();
  if (reason) query.set("reason", reason);
  query.set("returnTo", path);
  return `/login?${query.toString()}`;
}

/**
 * Login URL that brings the person back to the page they were on.
 * `returnTo` must be a same-origin path. Anything else goes home.
 * `reason=signed-out` only when there was a session to lose; otherwise
 * `reason=sign-in`, so the login page asks rather than says "signed out".
 */
export function signedOutLoginPath(returnTo: string, hadSession: boolean = wasSignedIn()): string {
  return loginHref(returnTo, hadSession ? "signed-out" : "sign-in");
}

/** The page the browser is on, including the query string. */
export function currentReturnPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

/**
 * Where to send someone whose request came back 401. The API's `loginUrl`
 * only knows the API route; the page the person is on (path and query) is the
 * one to come back to. The API's reason (signed out vs never signed in) is kept.
 */
export function signInAgainUrl(body?: unknown): string {
  const loginUrl =
    body && typeof body === "object" ? (body as { loginUrl?: unknown }).loginUrl : undefined;
  let reason: string | null = null;
  if (typeof loginUrl === "string") {
    try {
      reason = new URL(loginUrl, PROBE_ORIGIN).searchParams.get("reason");
    } catch {
      reason = null;
    }
  }
  if (reason !== "signed-out" && reason !== "sign-in") reason = wasSignedIn() ? "signed-out" : "sign-in";
  return loginHref(currentReturnPath(), reason);
}

/**
 * "Log in or sign up" in the user menu: come back to the page the person is
 * on, path and query. Login and onboarding themselves are not a place to
 * return to, so those go home.
 */
export function menuLoginHref(): string {
  const here = currentReturnPath();
  const returnTo = /^\/(?:login|onboarding)(?:[/?#]|$)/.test(here) ? "/" : here;
  return loginHref(returnTo, "join");
}
