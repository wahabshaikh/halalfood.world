import { createAuth } from "./auth";

export type RequestAuth =
  | { status: "authenticated"; userId: string }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

async function lookupSession(request: Request) {
  const auth = await createAuth();
  return auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
}

/** Authoritative session lookup for routes that mutate application data. */
export async function getRequestAuth(request: Request): Promise<RequestAuth> {
  try {
    const result = await lookupSession(request);
    const userId = result?.user?.id;
    return typeof userId === "string" && userId
      ? { status: "authenticated", userId }
      : { status: "unauthenticated" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Whether the request carries a session cookie at all. Only for choosing copy
 * (a sign-up nudge versus a welcome back) — never for access decisions, which
 * go through `getRequestAuth`.
 */
export async function looksSignedIn(): Promise<boolean> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return Boolean(
      jar.get("better-auth.session_token")?.value ||
        jar.get("__Secure-better-auth.session_token")?.value,
    );
  } catch {
    return false;
  }
}

/**
 * The signed-in user for a server-rendered page, or `null` when signed out or
 * the lookup fails. Pages use it to choose what to show (follow state, private
 * content); every route that changes data resolves the session on its own.
 */
export async function getViewerId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const auth = await createAuth();
    const result = await auth.api.getSession({
      headers: await headers(),
      query: { disableCookieCache: true },
    });
    const userId = result?.user?.id;
    return typeof userId === "string" && userId ? userId : null;
  } catch {
    return null;
  }
}
