import { database } from "@/lib/db";
import { linkBase } from "@/lib/environment";
import { deploymentEnvironment, readBinding, readWorkerEnv } from "@/lib/worker-env";
import { MCP_WRITE_LIMITER_BINDING, type WriteLimiter } from "./limits";
import type { ScoutEnvironment } from "./mcp";

/** The Worker's secret, rate limiter, database and public origin for one Scout request. */
export async function scoutEnvironment(request: Request): Promise<ScoutEnvironment> {
  const limiter = await readBinding<WriteLimiter>(MCP_WRITE_LIMITER_BINDING);
  return {
    secret: await readWorkerEnv("MCP_ADMIN_SECRET"),
    limiter: limiter && typeof limiter.limit === "function" ? limiter : undefined,
    deps: async () => ({
      db: await database(),
      origin: linkBase(request.url, (await readWorkerEnv("BETTER_AUTH_URL")) || undefined, await deploymentEnvironment()),
      now: Date.now,
    }),
  };
}
