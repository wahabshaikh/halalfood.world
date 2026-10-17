/**
 * Alert sign-up input. Stored unconfirmed and weekly; nothing is emailed until double opt-in ships (M4).
 */
import { normalizeEmail } from "@/lib/otp-rate-limit";
import { certifierSlugParam } from "./names";
import { isScopeCode, SCOPE_CODES } from "./scopes";
import type { AlertFilter } from "./repository";

export const ALERT_AUTHORITIES = ["bpjph"] as const;
const MAX_CERTIFIERS = 20;

export type AlertSignup = { email: string; filter: AlertFilter; turnstileToken: string };

export type AlertSignupParse = { ok: true; value: AlertSignup } | { ok: false; error: string };

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export function parseAlertSignup(body: unknown): AlertSignupParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a valid JSON object." };
  const input = body as Record<string, unknown>;
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  const authorities = stringList(input.authorities);
  if (!authorities || authorities.some((id) => !(ALERT_AUTHORITIES as readonly string[]).includes(id)))
    return { ok: false, error: "Choose countries from the list." };

  const certifiers = stringList(input.certifiers);
  if (!certifiers || certifiers.length > MAX_CERTIFIERS || certifiers.some((slug) => certifierSlugParam(slug) !== slug))
    return { ok: false, error: `Choose up to ${MAX_CERTIFIERS} certifiers from the directory.` };

  const scopes = stringList(input.scopes);
  if (!scopes || !scopes.every(isScopeCode)) return { ok: false, error: "Choose product scopes from the list." };

  const token = typeof input.turnstileToken === "string" ? input.turnstileToken.trim() : "";
  if (!token) return { ok: false, error: "Please complete the bot check." };

  return {
    ok: true,
    value: {
      email,
      filter: {
        authorities: authorities.length ? authorities.sort() : [...ALERT_AUTHORITIES],
        certifiers: certifiers.sort(),
        scopes: SCOPE_CODES.filter((code) => scopes.includes(code)),
      },
      turnstileToken: token,
    },
  };
}
