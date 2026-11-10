import { BODY_TOO_LARGE, INVALID_JSON, badRequest, json, readBoundedJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { parseClaimCheckout } from "@/lib/core/owner-claim";
import { linkBase } from "@/lib/environment";
import { consumeSponsorCheckoutLimits } from "@/lib/otp-rate-limit";
import { attachClaimCheckout, discardPendingClaim, startOwnerClaim } from "@/lib/owner-claims";
import { createOwnerClaimCheckout, ownerClaimConfig } from "@/lib/whop";
import { deploymentEnvironment, readWorkerEnv } from "@/lib/worker-env";

const NOT_OFFERED = "Restaurant claims are not available right now. Email support@halalfood.world and we'll set it up.";

/** Body `{placeId, role, contactEmail}`. Holds the restaurant and returns the Whop checkout URL. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/claim");
  if (!outcome.ok) return outcome.response;
  const body = await readBoundedJson(request, 8_000);
  if (body === BODY_TOO_LARGE) return badRequest("That is too large.");
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseClaimCheckout(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const config = await ownerClaimConfig();
  if (!config) return unavailable(NOT_OFFERED);
  const limited = await spendBudget(consumeSponsorCheckoutLimits, outcome.auth);
  if (limited) return limited;
  try {
    const started = await startOwnerClaim(outcome.auth.userId, parsed.value);
    if (!started.ok) return json({ error: started.error }, { status: started.status });
    const base = linkBase(request.url, (await readWorkerEnv("BETTER_AUTH_URL")) || undefined, await deploymentEnvironment());
    try {
      const checkout = await createOwnerClaimCheckout(config, {
        claimId: started.value.id,
        userId: outcome.auth.userId,
        placeId: parsed.value.placeId,
        planId: config.planId,
        redirectUrl: `${base}/claim/${parsed.value.placeId}?paid=1`,
      });
      await attachClaimCheckout(started.value.id, checkout.id);
      return json({ id: started.value.id, checkoutUrl: checkout.purchaseUrl }, { status: 201 });
    } catch {
      if (started.value.created) await discardPendingClaim(started.value.id).catch(() => undefined);
      return unavailable("Checkout could not be opened. Please try again.");
    }
  } catch {
    return unavailable();
  }
}
