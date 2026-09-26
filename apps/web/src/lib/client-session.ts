/**
 * One session lookup per page load, shared by every client component.
 *
 * A place page used to call `/api/auth/get-session` from five components, and
 * Better Auth's `useSession` store refetched it again on every tab focus. Each
 * call is a Worker invocation, so they are collapsed here into one request.
 * Sign-in finishes with a full page load, which starts a fresh lookup.
 *
 * This is for choosing what to show only. Every route that changes data
 * resolves the session again on the server.
 */

export type ClientSessionUser = {
  id: string;
  email: string | null;
  name: string | null;
};

let sessionLoad: Promise<ClientSessionUser | null> | null = null;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchSessionUser(): Promise<ClientSessionUser | null> {
  const response = await fetch("/api/auth/get-session", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Session lookup failed");
  const body = (await response.json().catch(() => null)) as {
    user?: Record<string, unknown>;
  } | null;
  const user = body?.user;
  const id = text(user?.id);
  return id ? { id, email: text(user?.email), name: text(user?.name) } : null;
}

/** The signed-in user, or `null` when signed out or the lookup failed. */
export function getClientSession(): Promise<ClientSessionUser | null> {
  if (!sessionLoad) {
    sessionLoad = fetchSessionUser().catch(() => {
      // Let a later caller retry instead of pinning a transient failure.
      sessionLoad = null;
      return null;
    });
  }
  return sessionLoad;
}

/** Whether the visitor is signed in, as far as the UI needs to know. */
export async function isClientSignedIn(): Promise<boolean> {
  return (await getClientSession()) !== null;
}
