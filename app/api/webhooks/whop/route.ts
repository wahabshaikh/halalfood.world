import { NO_STORE } from "@/lib/api";
import { applyWhopWebhook } from "@/lib/whop-webhooks";
import { verifyWhopWebhook } from "@/lib/whop";
import { readWorkerEnv } from "@/lib/worker-env";

const MAX_BODY_BYTES = 256 * 1024;

function reply(status: number, text: string): Response {
  return new Response(text, { status, headers: { ...NO_STORE, "Content-Type": "text/plain" } });
}

/**
 * Whop payment, membership and refund webhooks. Signed with
 * `WHOP_WEBHOOK_SECRET`; anything unsigned is 401. A 5xx makes Whop retry, which the handler absorbs.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = await readWorkerEnv("WHOP_WEBHOOK_SECRET");
  if (!secret) return reply(503, "Webhooks are not configured.");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return reply(413, "Too large.");
  const payload = await request.text();
  if (payload.length > MAX_BODY_BYTES) return reply(413, "Too large.");
  const verified = await verifyWhopWebhook(payload, request.headers, secret);
  if (!verified) return reply(401, "Invalid signature.");
  try {
    await applyWhopWebhook(verified.id, verified.body);
    return reply(200, "OK");
  } catch {
    return reply(503, "Try again.");
  }
}
