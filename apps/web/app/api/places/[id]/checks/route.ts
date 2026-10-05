import { placeIdParam } from "@halalfood/core/params";
import { checkOutcome, disagreesWith, validateCheck } from "@halalfood/core/check";
import { INVALID_JSON, badRequest, json, notFound, readJson, requireUser, spendBudget, unavailable } from "../../../../../src/lib/api";
import { CheckPlaceMissing, createCheck } from "../../../../../src/lib/checks-repository";
import { consumeCheckInLimits } from "../../../../../src/lib/otp-rate-limit";
import { getPlaceById } from "../../../../../src/lib/places";
import { afterCheck } from "../../../../../src/lib/check-effects";

/** Send a check (spec §5.1). It counts straight away. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = placeIdParam((await params).id);
  if (!id) return badRequest("Invalid place id.");
  const outcome = await requireUser(request, `/place/${id}/check`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateCheck(body);
  if (!validation.ok) return json({ error: validation.error }, { status: 422 });
  const limited = await spendBudget(consumeCheckInLimits, outcome.auth, "You’ve sent a lot of checks today. Please try again tomorrow.");
  if (limited) return limited;
  try {
    const result = await createCheck(outcome.auth.userId, id, validation.value);
    const place = await getPlaceById(id);
    if (result.recompute && place) await afterCheck(outcome.auth.userId, place, result.checkId, validation.value, result.recompute);
    const status = place?.card.status ?? { kind: "unchecked" as const };
    return json(
      {
        checkId: result.checkId,
        deduped: result.deduped,
        before: result.recompute?.before ?? status,
        status,
        message: result.recompute
          ? checkOutcome(result.recompute.before, status, place?.name ?? "This place", {
              disagreed: disagreesWith(validation.value, result.recompute.previousValues),
              counted: result.recompute.derived.authorsNewestFirst.includes(outcome.auth.userId),
            })
          : "Your check is in.",
      },
      { status: result.deduped ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof CheckPlaceMissing) return notFound(error.message);
    return unavailable("Checks are temporarily unavailable. Please try again.");
  }
}
