import { createAuth } from "./auth";

export type RequestAuth =
  | { status: "authenticated"; userId: string }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

/** Authoritative session lookup for routes that mutate application data. */
export async function getRequestAuth(request: Request): Promise<RequestAuth> {
  try {
    const result = await createAuth().api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    const userId = result?.user?.id;
    return typeof userId === "string" && userId
      ? { status: "authenticated", userId }
      : { status: "unauthenticated" };
  } catch {
    return { status: "unavailable" };
  }
}
