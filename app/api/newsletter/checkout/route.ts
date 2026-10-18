import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { linkBase } from "@/lib/environment";
import { consumeSponsorCheckoutLimits } from "@/lib/otp-rate-limit";
import { createNewsletterCheckout, newsletterConfig } from "@/lib/whop";
import { deploymentEnvironment, readWorkerEnv } from "@/lib/worker-env";

/** Open a newsletter checkout owned by the signed-in account. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/newsletter");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object" || Array.isArray(body)) return badRequest("Send a valid JSON object.");
  try {
    const config = await newsletterConfig();
    if (!config) return unavailable("Newsletter subscriptions are not available yet. Please check back soon.");
    const limited = await spendBudget(consumeSponsorCheckoutLimits, outcome.auth);
    if (limited) return limited;
    const base = linkBase(request.url, (await readWorkerEnv("BETTER_AUTH_URL")) || undefined, await deploymentEnvironment());
    const checkout = await createNewsletterCheckout(config, { userId: outcome.auth.userId, redirectUrl: `${base}/newsletter`, planId: config.planId });
    return json({ url: checkout.purchaseUrl });
  } catch {
    return unavailable("Checkout could not be opened. Please try again.");
  }
}
