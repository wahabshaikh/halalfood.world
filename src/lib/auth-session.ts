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
