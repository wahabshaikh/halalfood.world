/** Dispatch a verified Whop delivery to the newsletter and sponsorship handlers. */
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { parseNewsletterEvent } from "@/lib/core/newsletter";
import { parseWhopEvent } from "@/lib/core/sponsorship";
import { applyNewsletterEvent } from "@/lib/newsletter";
import { applyWhopEvent } from "@/lib/sponsorships";
import { readWorkerEnv } from "@/lib/worker-env";

/** Record one delivery only after both handlers succeed, so partial failures can be retried. */
export async function applyWhopWebhook(id: string, body: unknown, now = Date.now()): Promise<void> {
  const db = await database();
  const [seen] = await db.all<{ id: string }>(sql`SELECT id FROM whop_webhook_events WHERE id = ${id}`);
  if (seen) return;
  const [planId, productId] = await Promise.all([readWorkerEnv("WHOP_NEWSLETTER_PLAN_ID"), readWorkerEnv("WHOP_NEWSLETTER_PRODUCT_ID")]);
  const newsletter = parseNewsletterEvent(body, { planId, productId }, now);
  if (newsletter) await applyNewsletterEvent(newsletter, db, now);
  await applyWhopEvent(id, parseWhopEvent(body, now), db, now);
}
