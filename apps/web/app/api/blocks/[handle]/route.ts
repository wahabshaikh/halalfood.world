import { sql } from "drizzle-orm";
import { HANDLE_PATTERN, normalizeHandle } from "@halalfood/core/social";
import { database } from "../../../../src/db";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import { blockUser, unblockUser } from "../../../../src/lib/social-repository";
import {
  badRequest,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

async function targetOf(
  rawHandle: string,
  userId: string,
): Promise<{ response: Response } | { targetId: string }> {
  const handle = normalizeHandle(decodeURIComponent(rawHandle));
  if (!handle || !HANDLE_PATTERN.test(handle))
    return { response: badRequest("That is not a valid handle.") };
  const db = await database();
  const rows = await db.all<{ user_id?: unknown }>(sql`
    SELECT user_id FROM user_profiles WHERE handle = ${handle} LIMIT 1
  `);
  const targetId = rows[0]?.user_id;
  if (typeof targetId !== "string")
    return { response: notFound("That diner could not be found.") };
  if (targetId === userId)
    return { response: badRequest("You cannot block yourself.") };
  return { targetId };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const outcome = await requireUser(request, "/settings");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const target = await targetOf((await params).handle, outcome.auth.userId);
    if ("response" in target) return target.response;
    await blockUser(outcome.auth.userId, target.targetId);
    return json({ blocked: true });
  } catch {
    return unavailable();
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const outcome = await requireUser(request, "/settings");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const target = await targetOf((await params).handle, outcome.auth.userId);
    if ("response" in target) return target.response;
    await unblockUser(outcome.auth.userId, target.targetId);
    return json({ blocked: false });
  } catch {
    return unavailable();
  }
}
