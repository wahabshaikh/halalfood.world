import { createAuth } from "../../../../src/lib/auth";
import {
  consumeOtpRequestLimits,
  consumeOtpVerificationLimits,
  getClientIp,
  normalizeEmail,
  retryAfterSeconds,
} from "../../../../src/lib/otp-rate-limit";
import { verifyTurnstile } from "../../../../src/lib/turnstile";

const SEND_OTP_PATH = "/email-otp/send-verification-otp";
const VERIFY_OTP_PATHS = new Set([
  "/sign-in/email-otp",
  "/email-otp/check-verification-otp",
]);

type JsonBody = Record<string, unknown>;

async function readJson(request: Request): Promise<JsonBody> {
  try {
    const body: unknown = await request.clone().json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as JsonBody)
      : {};
  } catch {
    return {};
  }
}

function endpointPath(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const base = "/api/auth";
  return pathname.startsWith(base) ? pathname.slice(base.length) || "/" : "";
}

function unavailable() {
  return Response.json(
    { error: "Sign-in is temporarily unavailable. Please try again." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function rateLimited(retryAfterMs: number) {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    { error: "Too many sign-in attempts. Please try again later." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(seconds),
        "X-Retry-After": String(seconds),
      },
    },
  );
}

async function handle(request: Request): Promise<Response> {
  const path = endpointPath(request);
  if (request.method === "POST" && path === SEND_OTP_PATH) {
    const body = await readJson(request);
    const token =
      request.headers.get("x-turnstile-token") ||
      (typeof body["cf-turnstile-response"] === "string"
        ? body["cf-turnstile-response"]
        : null);
    const turnstile = await verifyTurnstile(request, token);
    if (!turnstile.ok) {
      return turnstile.reason === "rejected" || turnstile.reason === "missing-token"
        ? Response.json(
            { error: "Please complete the bot check and try again." },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          )
        : unavailable();
    }

    const email = normalizeEmail(body.email);
    if (email) {
      try {
        const decision = await consumeOtpRequestLimits(
          email,
          getClientIp(request),
        );
        if (!decision.allowed) return rateLimited(decision.retryAfterMs);
      } catch {
        // A failed counter check must never fall through and burn a Resend send.
        return unavailable();
      }
    }
  }

  if (request.method === "POST" && VERIFY_OTP_PATHS.has(path)) {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    if (email && typeof body.otp === "string") {
      try {
        const decision = await consumeOtpVerificationLimits(
          email,
          getClientIp(request),
        );
        if (!decision.allowed) return rateLimited(decision.retryAfterMs);
      } catch {
        // Verification is fail closed too: do not allow unlimited guesses while
        // the durable counter store is unavailable.
        return unavailable();
      }
    }
  }

  try {
    return await createAuth().handler(request);
  } catch {
    return unavailable();
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
