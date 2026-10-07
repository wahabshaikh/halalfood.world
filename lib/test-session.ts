/** Input for POST /api/test/session (non-production only). Validated by hand like the rest of the API. */
export type TestSessionInput = {
  email: string;
  name?: string;
  /** false leaves the account before /welcome, so tests can drive onboarding. */
  onboarded: boolean;
  moderator: boolean;
  /** Backdates the account. Checks only count from accounts at least 24 hours old. */
  ageDays?: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseTestSessionInput(body: unknown): TestSessionInput | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send a JSON object." };
  const value = body as Record<string, unknown>;
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return { error: "Send a valid email." };
  const name = value.name === undefined ? undefined : typeof value.name === "string" ? value.name.trim().slice(0, 80) : null;
  if (name === null || name === "") return { error: "name must be a non-empty string." };
  if (value.onboarded !== undefined && typeof value.onboarded !== "boolean") return { error: "onboarded must be true or false." };
  if (value.moderator !== undefined && typeof value.moderator !== "boolean") return { error: "moderator must be true or false." };
  const ageDays = value.ageDays;
  if (ageDays !== undefined && (typeof ageDays !== "number" || !Number.isFinite(ageDays) || ageDays < 0 || ageDays > 3650)) {
    return { error: "ageDays must be a number from 0 to 3650." };
  }
  return { email, name, onboarded: value.onboarded !== false, moderator: value.moderator === true, ageDays: ageDays as number | undefined };
}
