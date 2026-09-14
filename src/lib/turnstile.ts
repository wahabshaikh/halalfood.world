const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerification =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-config" | "missing-token" | "rejected" | "unavailable";
    };

interface TurnstileResponse {
  success?: unknown;
}

/**
 * Validate a Turnstile response server-side. Both keys are required even if
 * the public site key is only used to render the client widget.
 */
export async function verifyTurnstile(
  request: Request,
  token: string | null,
  fetcher: typeof fetch = fetch,
): Promise<TurnstileVerification> {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!siteKey || !secretKey) return { ok: false, reason: "missing-config" };
  if (!token || token.length > 2048) {
    return { ok: false, reason: "missing-token" };
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });
  const ip = request.headers.get("cf-connecting-ip")?.trim();
  if (ip) body.set("remoteip", ip);

  let response: Response;
  try {
    response = await fetcher(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };

  let payload: TurnstileResponse;
  try {
    payload = (await response.json()) as TurnstileResponse;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return payload.success === true
    ? { ok: true }
    : { ok: false, reason: "rejected" };
}
