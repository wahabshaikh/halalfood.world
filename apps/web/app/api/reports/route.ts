import { sql } from "drizzle-orm";
import { validateReport } from "@halalfood/core/moderation";
import { database } from "../../../src/db";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "../../../src/lib/api";
import { consumeContributionLimits } from "../../../src/lib/otp-rate-limit";

/** File a report about a place, a check, a comment, a person or a list. */
export async function POST(request: Request) {
  const outcome = await requireUser(request, "/");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateReport(body);
  if (!validation.ok) return badRequest(validation.error);
  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;
  const { targetType, targetId, reason, detail } = validation.value;
  try {
    const db = await database();
    const now = Date.now();
    const id = crypto.randomUUID();
    await db.run(sql`
      INSERT INTO reports (id, target_type, target_id, reporter_id, reason, detail, status, created_at, updated_at)
      VALUES (${id}, ${targetType}, ${targetId}, ${outcome.auth.userId}, ${reason}, ${detail}, 'open', ${now}, ${now})
    `);
    return json({ id }, { status: 201 });
  } catch {
    return unavailable("Reports are temporarily unavailable. Please try again.");
  }
}
