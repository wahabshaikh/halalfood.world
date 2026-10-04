/**
 * What a diner is called in public.
 *
 * An email address is an account credential. It is never a display name, a
 * handle, or a fallback when a profile is missing.
 */

export const PUBLIC_MEMBER_LABEL = "Halalfood member";

export function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

/** The first candidate that is present and is not an email address. */
export function safePublicIdentity(
  candidates: ReadonlyArray<string | null | undefined>,
  fallback = PUBLIC_MEMBER_LABEL,
): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (!value || looksLikeEmail(value)) continue;
    return value;
  }
  return fallback;
}
