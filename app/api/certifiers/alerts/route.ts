import { INVALID_JSON, badRequest, json, optionalUser, rateLimited, readJson, unavailable } from "@/lib/api";
import { parseAlertSignup } from "@/lib/certifiers/alerts";
import { saveAlertSubscription } from "@/lib/certifiers/repository";
import { consumeCertAlertSignupLimits, getClientIp } from "@/lib/otp-rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * Sign up for certifier change alerts. Body `{email, authorities?, certifiers?, scopes?, turnstileToken}`.
 * Stored unconfirmed (weekly); no email is sent until double opt-in ships. Anonymous, so it is guarded
 * by Turnstile and per-email and per-IP budgets, like sign-in codes. The answer is the same whether or
 * not the address had already signed up.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseAlertSignup(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const turnstile = await verifyTurnstile(request, parsed.value.turnstileToken);
  if (!turnstile.ok) {
    if (turnstile.reason === "missing-config" || turnstile.reason === "unavailable") return unavailable();
    return badRequest("The bot check failed. Please try again.");
  }

  try {
    const decision = await consumeCertAlertSignupLimits(parsed.value.email, getClientIp(request));
    if (!decision.allowed) return rateLimited(decision.retryAfterMs);
    await saveAlertSubscription(parsed.value.email, parsed.value.filter, await optionalUser(request).catch(() => null));
  } catch {
    return unavailable();
  }
  return json({ ok: true, confirmed: false });
}
