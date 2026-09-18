import { createAuth } from "./auth";

export type RequestAuth =
  | { status: "authenticated"; userId: string }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

export type RequestSessionUser =
  | { status: "authenticated"; userId: string; email: string; name: string | null }
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

/** Session lookup that also exposes the signed-in user's email and name. */
export async function getRequestSessionUser(
  request: Request,
): Promise<RequestSessionUser> {
  try {
    const result = await lookupSession(request);
    const userId = result?.user?.id;
    const email = result?.user?.email;
    if (
      typeof userId !== "string" ||
      !userId ||
      typeof email !== "string" ||
      !email
    )
      return { status: "unauthenticated" };
    const name =
      typeof result?.user?.name === "string" ? result.user.name : null;
    return { status: "authenticated", userId, email, name };
  } catch {
    return { status: "unavailable" };
  }
}
