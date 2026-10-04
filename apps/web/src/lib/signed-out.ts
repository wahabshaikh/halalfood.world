/** Shown when an action comes back 401. */
export const SIGNED_OUT_COPY = "You've been signed out. Sign in again.";

/**
 * Login URL that brings the person back to the page they were on.
 * `returnTo` must be a same-origin path. Anything else goes home.
 */
export function signedOutLoginPath(returnTo: string): string {
  const path =
    returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\")
      ? returnTo
      : "/";
  return `/login?reason=signed-out&returnTo=${encodeURIComponent(path)}`;
}

/** The page the browser is on, including the query string. */
export function currentReturnPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}
