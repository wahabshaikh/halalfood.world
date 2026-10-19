/** Pure newsletter membership rules; Whop billing and D1 live at the edges. */
export type NewsletterIds = { planId?: string; productId?: string };
export type NewsletterMembership = {
  id: string;
  userId: string | null;
  whopUserId: string | null;
  productId: string | null;
  planId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  manageUrl: string | null;
  eventAt: number;
};

const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const time = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Access continues during trials, payment retries and cancellation at the end of the paid period. */
export function grantsNewsletterAccess(status: string): boolean {
  return ["active", "trialing", "canceling", "past_due"].includes(status);
}

/** Only link to Whop's HTTPS management pages from provider payloads. */
function manageLink(value: unknown): string | null {
  try {
    const url = new URL(str(value) ?? "");
    return url.protocol === "https:" && (url.hostname === "whop.com" || url.hostname.endsWith(".whop.com")) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** An id that Whop sends flat (`product_id`, 2026-10-15-1 pins) or nested (`product: {id}`, unpinned/legacy webhooks). */
const ref = (data: Record<string, unknown>, name: string): string | null => str(data[`${name}_id`]) ?? str(obj(data[name]).id);

/**
 * Read supported newsletter membership events, ignoring unrelated products and malformed payloads.
 * Accepts both Whop membership shapes: the legacy one that unpinned webhooks (any created in the dashboard) send,
 * with nested `product`/`plan`/`user` and `renewal_period_end`, and the dated 2026-10-15-1 one with flat ids and
 * `current_period_end`.
 */
export function parseNewsletterEvent(body: unknown, config: NewsletterIds, now: number): NewsletterMembership | null {
  const event = obj(body);
  if (!["membership.activated", "membership.updated", "membership.deactivated", "membership.cancel_at_period_end_changed"].includes(String(event.type))) return null;
  const data = obj(event.data);
  const metadata = obj(data.metadata);
  const productId = ref(data, "product");
  const planId = ref(data, "plan");
  if (metadata.kind !== "newsletter" && !(config.productId && productId === config.productId) && !(config.planId && planId === config.planId)) return null;
  const id = str(data.id);
  const status = str(data.status);
  if (!id || !status) return null;
  return {
    id, status, productId, planId,
    userId: str(metadata.user_id),
    whopUserId: ref(data, "user"),
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    currentPeriodEnd: time(data.current_period_end) ?? time(data.renewal_period_end),
    manageUrl: manageLink(data.manage_url),
    eventAt: time(event.timestamp) ?? now,
  };
}
