/**
 * When a failed client read may try again on its own.
 *
 * A read that fails must never feed its own failure back into what triggers
 * it. That is how the map sent 1,774 `/api/discover` requests in 17 seconds:
 * each 401 wrote a fresh filters object, the effect saw a new dependency and
 * fetched again, forever. The rules here keep every automatic retry bounded:
 *
 * - 401 and 403 never retry by themselves. Signing in, or another account,
 *   is the only thing that changes the answer.
 * - Other 4xx are the request's fault and do not retry either.
 * - 429, 5xx and network failures retry with exponential backoff, at most
 *   `MAX_AUTO_RETRIES` times, then wait for the person to press Try again.
 */

export const MAX_AUTO_RETRIES = 3;
export const BASE_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;

export type RetryDecision =
  | { auto: true; delayMs: number }
  | { auto: false; reason: "sign-in" | "forbidden" | "client" | "exhausted" };

/** Exponential backoff with jitter: about 1 s, 2 s, 4 s … capped at 30 s. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempt));
  // Up to 25% jitter so many tabs that failed together do not retry together.
  return Math.round(exponential * (0.75 + random() * 0.25));
}

/** `Retry-After` in seconds or as an HTTP date, in milliseconds. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_MS, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(MAX_RETRY_MS, Math.max(0, at - now)) : null;
}

/**
 * Whether failure number `attempt` (0 for the first) may retry by itself.
 * `status` is the HTTP status, or "network" when no response arrived.
 */
export function retryDecision(
  status: number | "network",
  attempt: number,
  options: { retryAfter?: string | null; random?: () => number } = {},
): RetryDecision {
  if (status === 401) return { auto: false, reason: "sign-in" };
  if (status === 403) return { auto: false, reason: "forbidden" };
  if (status !== "network" && status !== 429 && status < 500)
    return { auto: false, reason: "client" };
  if (attempt >= MAX_AUTO_RETRIES) return { auto: false, reason: "exhausted" };
  const hinted = status === 429 ? retryAfterMs(options.retryAfter) : null;
  return { auto: true, delayMs: hinted ?? backoffMs(attempt, options.random) };
}
