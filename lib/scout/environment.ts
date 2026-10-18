import { database } from "@/lib/db";
import { getGooglePlacesApiKey } from "@/lib/google-places";
import { readGoogleDetailsDailyCap, readGoogleSearchDailyCap } from "@/lib/google-search-budget";
import { linkBase } from "@/lib/environment";
import { deploymentEnvironment, readBinding, readWorkerEnv } from "@/lib/worker-env";
import { MCP_WRITE_LIMITER_BINDING, type WriteLimiter } from "./limits";
import type { ScoutEnvironment } from "./mcp";

/** The Worker's secret, rate limiter, database, public origin and Google key and caps for one Scout request. */
export async function scoutEnvironment(request: Request): Promise<ScoutEnvironment> {
  const limiter = await readBinding<WriteLimiter>(MCP_WRITE_LIMITER_BINDING);
  return {
    secret: await readWorkerEnv("MCP_ADMIN_SECRET"),
    limiter: limiter && typeof limiter.limit === "function" ? limiter : undefined,
    deps: async () => ({
      db: await database(),
      origin: linkBase(request.url, (await readWorkerEnv("BETTER_AUTH_URL")) || undefined, await deploymentEnvironment()),
      now: Date.now,
      // The same key and daily caps as add-a-place search; no key means no geocoding.
      google: {
        apiKey: (await readWorkerEnv("GOOGLE_PLACES_API_KEY")).trim() || (await readWorkerEnv("GOOGLE_MAPS_API_KEY")).trim() || getGooglePlacesApiKey(),
        searchCap: await readGoogleSearchDailyCap(),
        detailsCap: await readGoogleDetailsDailyCap(),
      },
    }),
  };
}
