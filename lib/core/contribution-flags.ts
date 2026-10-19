/** Suspicious contributions stay live until a moderator reviews the evidence. */
export const FLAG_LABELS = {
  velocity: "More than 5 vouches in 10 minutes",
  distance: "Vouches over 100 km apart within an hour",
  self_vouch: "New member vouched for their own addition",
  ip_cluster: "Same-network vouch cluster",
};
export type FlagKind = keyof typeof FLAG_LABELS;
export type FlagReview = { action: "dismiss" | "uphold"; reason: string };

/** A moderator must explain either review outcome. */
export function parseFlagReview(body: unknown): { ok: true; value: FlagReview } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a review." };
  const { action, reason } = body as Record<string, unknown>;
  if (action !== "dismiss" && action !== "uphold") return { ok: false, error: "Choose Dismiss or Uphold." };
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 300)
    return { ok: false, error: "Give a reason in 300 characters or fewer." };
  return { ok: true, value: { action, reason: reason.trim() } };
}
