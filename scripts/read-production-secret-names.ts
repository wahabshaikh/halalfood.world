import { spawnSync } from "node:child_process";
import {
  PRODUCTION_WORKER_NAME,
  productionSecretNamesFromCommand,
  SECRET_LIST_TIMEOUT_MS,
} from "../apps/web/src/lib/preview-bindings.ts";

/**
 * Names of secrets on the production Worker. `wrangler secret list` prints
 * names, not values. A failed or timed-out list refuses the preview build
 * instead of using a hardcoded name list that can drift.
 */
export function readProductionSecretNames(): string[] {
  const listed = spawnSync(
    "npx",
    ["wrangler", "secret", "list", "--name", PRODUCTION_WORKER_NAME, "--format", "json"],
    { encoding: "utf8", timeout: SECRET_LIST_TIMEOUT_MS },
  );
  return productionSecretNamesFromCommand({
    status: listed.status,
    stdout: listed.stdout ?? "",
    stderr: listed.stderr ?? "",
    error: listed.error,
  });
}
