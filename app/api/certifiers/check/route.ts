import { sql } from "drizzle-orm";
import { json, requireModerator, unavailable } from "@/lib/api";
import { runCertifierChecks } from "@/lib/certifiers/check";
import { database } from "@/lib/db";

/**
 * Run the official-list check now, as the daily cron does. Moderators only. It fetches every page of
 * each source politely (about 10 seconds for BPJPH) and answers with what changed.
 */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireModerator(request, "/admin");
  if (!outcome.ok) return outcome.response;
  try {
    const results = await runCertifierChecks();
    const db = await database();
    await db.run(sql`
      INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
      VALUES (${crypto.randomUUID()}, ${outcome.auth.userId}, 'cert-check-run', 'cert_source', 'all', NULL, NULL, ${JSON.stringify(results)}, ${Date.now()})
    `);
    return json({ results });
  } catch {
    return unavailable();
  }
}
