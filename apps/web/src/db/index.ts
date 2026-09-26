import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export const D1_BINDING_NAME = "DB";

/**
 * Resolve the D1 binding through `cloudflare:workers` rather than a fetch
 * handler parameter, so any module can reach it. The dynamic import fails
 * closed under plain Node (tests, scripts, local builds), matching the
 * pattern already used for the R2 binding in src/lib/r2.ts.
 */
async function d1Binding(): Promise<Parameters<typeof drizzle>[0] | null> {
  try {
    const workers = await import("cloudflare:workers");
    const candidate = workers.env?.[D1_BINDING_NAME];
    if (!candidate || typeof candidate !== "object") return null;
    const binding = candidate as { prepare?: unknown; batch?: unknown };
    return typeof binding.prepare === "function" && typeof binding.batch === "function"
      ? (candidate as Parameters<typeof drizzle>[0])
      : null;
  } catch {
    return null;
  }
}

/** Create a request-scoped D1/Drizzle client bound to the `DB` binding. */
export async function database() {
  const binding = await d1Binding();
  if (!binding) throw new Error("Database is not configured");
  return drizzle(binding, { schema });
}
