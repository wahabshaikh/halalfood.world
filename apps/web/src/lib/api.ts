/**
 * Shared response helpers for the JSON routes.
 *
 * Every mutation route follows the same shape: resolve the session, validate,
 * spend a durable rate-limit budget, then write. These helpers keep the error
 * bodies consistent and make sure nothing user-specific is ever cached.
 */

import { getRequestAuth, type RequestAuth } from "./auth-session";
import { getClientIp, retryAfterSeconds } from "./otp-rate-limit";
import { SIGNED_OUT_COPY, hasSessionCookie, signInCopyFor, signedOutLoginPath } from "./signed-out";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...NO_STORE, ...(init.headers ?? {}) },
  });
}

export function badRequest(error: string): Response {
  return json({ error }, { status: 400 });
}

export function notFound(error = "That page could not be found."): Response {
  return json({ error }, { status: 404 });
}

export function forbidden(error = "You cannot do that."): Response {
  return json({ error }, { status: 403 });
}

export function unavailable(
  error = "This is temporarily unavailable. Please try again.",
): Response {
  return json({ error }, { status: 503 });
}

/**
 * 401 body. `hadSession` says whether the request carried a session cookie:
 * with one, the person was signed out; without, they never signed in.
 */
export function unauthorized(returnTo: string, error?: string, hadSession = true): Response {
  return json(
    {
      error: error ?? (hadSession ? SIGNED_OUT_COPY : signInCopyFor(returnTo)),
      loginUrl: signedOutLoginPath(returnTo, hadSession),
    },
    { status: 401 },
  );
}

export function rateLimited(retryAfterMs: number, error = "Too many requests. Please try again later."): Response {
  const seconds = retryAfterSeconds(retryAfterMs);
  return json(
    { error },
    {
      status: 429,
      headers: { "Retry-After": String(seconds), "X-Retry-After": String(seconds) },
    },
  );
}

export type AuthedRequest = { userId: string; ip: string };

export type AuthOutcome =
  | { ok: true; auth: AuthedRequest }
  | { ok: false; response: Response };

/** Resolve the session or return the response the caller should send back. */
export async function requireUser(
  request: Request,
  returnTo: string,
  getAuth: (request: Request) => Promise<RequestAuth> = getRequestAuth,
): Promise<AuthOutcome> {
  const auth = await getAuth(request);
  if (auth.status === "unavailable") return { ok: false, response: unavailable() };
  if (auth.status === "unauthenticated")
    return { ok: false, response: unauthorized(returnTo, undefined, hasSessionCookie(request)) };
  return { ok: true, auth: { userId: auth.userId, ip: getClientIp(request) } };
}

/** Optional session: a signed-out visitor is not an error. */
export async function optionalUser(
  request: Request,
  getAuth: (request: Request) => Promise<RequestAuth> = getRequestAuth,
): Promise<string | null> {
  const auth = await getAuth(request);
  return auth.status === "authenticated" ? auth.userId : null;
}

export async function readJson(request: Request): Promise<unknown | symbol> {
  try {
    return await request.json();
  } catch {
    return INVALID_JSON;
  }
}

export const INVALID_JSON = Symbol("invalid-json");

/** Spend a rate-limit budget, converting both failure modes to a response. */
export async function spendBudget(
  consume: (userId: string, ip: string) => Promise<{ allowed: boolean; retryAfterMs: number }>,
  auth: AuthedRequest,
  message?: string,
): Promise<Response | null> {
  try {
    const decision = await consume(auth.userId, auth.ip);
    if (!decision.allowed) return rateLimited(decision.retryAfterMs, message);
    return null;
  } catch {
    return unavailable();
  }
}
