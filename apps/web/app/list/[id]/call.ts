import { signInAgainUrl } from "../../../src/lib/signed-out";
/**
 * One fetch wrapper for the list controls: JSON in and out, and a signed-out
 * tap goes to log in and comes back to the same list.
 */
export type CallResult<T> = { ok: true; body: T } | { ok: false; error: string };

export async function call<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<CallResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as T & {
      error?: string;
      loginUrl?: string;
    };
    if (response.status === 401 && typeof parsed.loginUrl === "string") {
      window.location.assign(signInAgainUrl(parsed));
      return { ok: false, error: "Sign in to continue." };
    }
    if (!response.ok)
      return { ok: false, error: parsed.error ?? "Something went wrong. Please try again." };
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
