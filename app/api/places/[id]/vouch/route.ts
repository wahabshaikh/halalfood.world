import { placeIdParam } from "@/lib/core/params";
import { validateVouch } from "@/lib/core/contributions";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { consumeVouchLimits } from "@/lib/otp-rate-limit";
import { vouchForPlace } from "@/lib/vouches";

/** "I ate here" (spec §5.2). Body `{ateAt?, rating?, note?}`. It counts once the account is 24 hours old. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = placeIdParam((await params).id);
  if (!id) return badRequest("Invalid place id.");
  const outcome = await requireUser(request, `/place/${id}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateVouch(body);
  if (!validation.ok) return badRequest(validation.error);
  const limited = await spendBudget(consumeVouchLimits, outcome.auth, "You’ve vouched for a lot of places today. Please try again tomorrow.");
  if (limited) return limited;
  try {
    const result = await vouchForPlace(outcome.auth.userId, id, validation.value, { channel: "web", ip: outcome.auth.ip });
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    const { status, points, trust } = result.value;
    return json(
      {
        status,
        points,
        trust: { score: trust.trustScore, band: trust.trustBand, communityVouchers: trust.communityVouchers },
        message: status === "accepted" ? "Thanks. Your vouch counts." : "Thanks. Your vouch is saved. Vouches from new accounts count after their first day.",
      },
      { status: 201 },
    );
  } catch {
    return unavailable("Vouching is temporarily unavailable. Please try again.");
  }
}
