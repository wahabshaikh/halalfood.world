/**
 * Whop: hosted checkout for city sponsorships, and verifying the webhooks it sends back.
 *
 * Checkout configurations carry `metadata.sponsorship_id`; Whop copies it onto the payment and membership,
 * so a webhook names the sponsorship it pays for. Webhooks are Standard Webhooks signed with HMAC-SHA256
 * over `{webhook-id}.{webhook-timestamp}.{body}`, keyed with the literal bytes of the `ws_…` secret.
 */
import { SPONSOR_PERIOD_DAYS, SPONSOR_PRICE_USD } from "@/lib/core/sponsorship";
import { readWorkerEnv } from "@/lib/worker-env";

const WHOP_API = "https://api.whop.com/api/v1";
/** Reject deliveries signed more than this far from now (replays). */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type WhopConfig = { apiKey: string; companyId: string };

/** The API key and company, or null when Whop isn't configured on this deployment. */
export async function whopConfig(): Promise<WhopConfig | null> {
  const [apiKey, companyId] = await Promise.all([readWorkerEnv("WHOP_API_KEY"), readWorkerEnv("WHOP_COMPANY_ID")]);
  return apiKey && companyId ? { apiKey, companyId } : null;
}

export type CheckoutRequest = { sponsorshipId: string; citySlug: string; cityLabel: string; redirectUrl: string };

/**
 * Create a Whop checkout for one city's monthly sponsorship and return its id and purchase URL.
 * Throws on any Whop failure; callers answer 503 without passing Whop's message on.
 */
export async function createSponsorCheckout(
  config: WhopConfig,
  request: CheckoutRequest,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; purchaseUrl: string }> {
  const response = await fetcher(`${WHOP_API}/checkout_configurations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": request.sponsorshipId,
    },
    body: JSON.stringify({
      mode: "payment",
      plan: {
        company_id: config.companyId,
        plan_type: "renewal",
        currency: "usd",
        initial_price: SPONSOR_PRICE_USD,
        renewal_price: SPONSOR_PRICE_USD,
        billing_period: SPONSOR_PERIOD_DAYS,
        title: `Sponsor ${request.cityLabel}`,
        description: `A monthly city sponsorship on halalfood.world for ${request.cityLabel}.`,
        product: { external_identifier: "halalfood-city-sponsorship", title: "halalfood.world city sponsorship" },
      },
      metadata: { sponsorship_id: request.sponsorshipId, city_slug: request.citySlug },
      redirect_url: request.redirectUrl,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Whop checkout failed with ${response.status}`);
  const body = (await response.json()) as { id?: unknown; purchase_url?: unknown };
  if (typeof body.id !== "string" || typeof body.purchase_url !== "string") throw new Error("Whop checkout response was incomplete");
  const purchaseUrl = new URL(body.purchase_url, "https://whop.com").href;
  return { id: body.id, purchaseUrl };
}

function base64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time string comparison. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export type WebhookHeaders = { get(name: string): string | null };

/**
 * Verify a Whop webhook against its signature headers. Returns the webhook id and the parsed body,
 * or null when the signature, timestamp or body is wrong.
 */
export async function verifyWhopWebhook(
  payload: string,
  headers: WebhookHeaders,
  secret: string,
  now = Date.now(),
): Promise<{ id: string; body: unknown } | null> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!secret || !id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp)) return null;
  if (Math.abs(now - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE_MS) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64(await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${payload}`)));
  // The header may hold several space-separated `v1,<sig>` entries during secret rotation.
  const matched = signatures
    .split(" ")
    .some((entry) => entry.startsWith("v1,") && sameText(entry.slice(3), expected));
  if (!matched) return null;
  try {
    return { id, body: JSON.parse(payload) as unknown };
  } catch {
    return null;
  }
}

/** Sign a payload the way Whop does. For tests and local webhook replays only. */
export async function signWhopWebhook(payload: string, id: string, timestampSeconds: number, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1,${base64(await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestampSeconds}.${payload}`)))}`;
}
