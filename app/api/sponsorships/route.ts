import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { parseSponsorInput } from "@/lib/core/sponsorship";
import { linkBase } from "@/lib/environment";
import { consumeSponsorCheckoutLimits } from "@/lib/otp-rate-limit";
import { getCity } from "@/lib/places";
import { cityName } from "@/lib/seo";
import { attachCheckout, discardPending, mySponsorships, startSponsorship } from "@/lib/sponsorships";
import { createSponsorCheckout, whopConfig } from "@/lib/whop";
import { deploymentEnvironment, readWorkerEnv } from "@/lib/worker-env";

const NOT_OFFERED = "Sponsorships are not available right now. Email support@halalfood.world and we'll set it up.";

/** Mine, newest first. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/sponsor");
  if (!outcome.ok) return outcome.response;
  try {
    return json({ sponsorships: await mySponsorships(outcome.auth.userId) });
  } catch {
    return unavailable();
  }
}

/** Body `{citySlug, name, tagline?, linkUrl}`. Holds the city and returns the Whop `checkoutUrl` to send the buyer to. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/sponsor");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseSponsorInput(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const config = await whopConfig();
  if (!config) return unavailable(NOT_OFFERED);
  const limited = await spendBudget(consumeSponsorCheckoutLimits, outcome.auth);
  if (limited) return limited;
  try {
    const city = await getCity(parsed.value.citySlug);
    if (!city) return json({ error: "That city could not be found." }, { status: 404 });
    const started = await startSponsorship(outcome.auth.userId, parsed.value);
    if (!started.ok) return json({ error: started.error }, { status: started.status });
    const base = linkBase(request.url, (await readWorkerEnv("BETTER_AUTH_URL")) || undefined, await deploymentEnvironment());
    try {
      const checkout = await createSponsorCheckout(config, {
        sponsorshipId: started.id,
        citySlug: city.city_slug,
        cityLabel: cityName(city.city_slug),
        redirectUrl: `${base}/sponsor/thanks?id=${started.id}`,
      });
      await attachCheckout(started.id, checkout.id);
      return json({ id: started.id, checkoutUrl: checkout.purchaseUrl }, { status: 201 });
    } catch {
      await discardPending(started.id).catch(() => undefined);
      return unavailable("Checkout could not be opened. Please try again.");
    }
  } catch {
    return unavailable();
  }
}
