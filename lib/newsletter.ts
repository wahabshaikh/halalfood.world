/** Newsletter membership persistence and access confirmation. */
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { grantsNewsletterAccess, type NewsletterMembership } from "@/lib/core/newsletter";
import { checkWhopAccess } from "@/lib/whop";
import { readWorkerEnv } from "@/lib/worker-env";
import { runBatch } from "./checks-repository";

type Client = ReturnType<typeof database> | Awaited<ReturnType<typeof database>>;

/** Upsert a verified membership; retries and events older than the stored event cannot change it. */
export async function applyNewsletterEvent(event: NewsletterMembership, client: Client = database(), now = Date.now()): Promise<void> {
  const db = await client;
  await runBatch(db, [sql`
    INSERT INTO whop_memberships (id, user_id, whop_user_id, product_id, plan_id, status, cancel_at_period_end, current_period_end, manage_url, event_at, created_at, updated_at)
    VALUES (${event.id}, (SELECT id FROM "user" WHERE id = ${event.userId}), ${event.whopUserId}, ${event.productId}, ${event.planId}, ${event.status},
      ${event.cancelAtPeriodEnd ? 1 : 0}, ${event.currentPeriodEnd}, ${event.manageUrl}, ${event.eventAt}, ${now}, ${now})
    ON CONFLICT(id) DO UPDATE SET
      user_id = COALESCE(whop_memberships.user_id, excluded.user_id),
      whop_user_id = COALESCE(excluded.whop_user_id, whop_memberships.whop_user_id),
      product_id = COALESCE(excluded.product_id, whop_memberships.product_id),
      plan_id = COALESCE(excluded.plan_id, whop_memberships.plan_id),
      status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
      current_period_end = excluded.current_period_end, manage_url = COALESCE(excluded.manage_url, whop_memberships.manage_url),
      event_at = excluded.event_at, updated_at = excluded.updated_at
    WHERE excluded.event_at > whop_memberships.event_at
  `]);
}

export type NewsletterStatus = { subscribed: boolean; manageUrl: string | null };

/** Read this account's memberships, confirming access with Whop when possible and falling back on errors. */
export async function newsletterStatusForUser(userId: string, client: Client = database()): Promise<NewsletterStatus> {
  const db = await client;
  const rows = await db.all<{ status: string; whop_user_id: string | null; manage_url: string | null }>(sql`
    SELECT status, whop_user_id, manage_url FROM whop_memberships WHERE user_id = ${userId} ORDER BY event_at DESC
  `);
  const [apiKey, productId] = await Promise.all([readWorkerEnv("WHOP_API_KEY"), readWorkerEnv("WHOP_NEWSLETTER_PRODUCT_ID")]);
  const confirmed = new Map<string, boolean>();
  let manageUrl: string | null = null;
  for (const row of rows) {
    manageUrl ??= row.manage_url;
    let subscribed = grantsNewsletterAccess(row.status);
    if (apiKey && productId && row.whop_user_id) {
      try {
        let access = confirmed.get(row.whop_user_id);
        if (access === undefined) {
          access = await checkWhopAccess({ apiKey }, row.whop_user_id, productId);
          confirmed.set(row.whop_user_id, access);
        }
        subscribed = access;
      } catch {
        // Billing outages must not remove access already confirmed by a signed webhook.
      }
    }
    if (subscribed) return { subscribed: true, manageUrl: row.manage_url };
  }
  return { subscribed: false, manageUrl };
}
