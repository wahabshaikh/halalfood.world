/**
 * Parse `wrangler d1 migrations list` and decide when a production deploy
 * must stop. The Workers Builds production branch is the only caller: preview
 * builds migrate a separate database, and local builds have no remote token.
 */

export function shouldGateProductionDeploy(env: {
  WORKERS_CI?: string;
  WORKERS_CI_BRANCH?: string;
}): boolean {
  return env.WORKERS_CI === "1" && (env.WORKERS_CI_BRANCH ?? "").trim() === "main";
}

/** Remote `migrations list` must finish inside this window or the build stops. */
export const MIGRATION_LIST_TIMEOUT_MS = 60_000;

/**
 * A non-zero exit, a spawn error, or a timeout all stop the deploy.
 * Timeout is reported on its own so a hung list is not treated as an empty one.
 */
export function migrationListStopReason(result: {
  status: number | null;
  error?: { code?: string } | null;
}): "timeout" | "failed" | null {
  if (result.error?.code === "ETIMEDOUT") return "timeout";
  if (result.error || result.status !== 0) return "failed";
  return null;
}

export type MigrationListParse =
  | { ok: true; pending: string[] }
  | { ok: false; reason: string };

const MIGRATION_FILE = /[0-9A-Za-z][0-9A-Za-z._/-]*\.sql/g;

function unique(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Wrangler prints `No migrations to apply!` or a table under
 * `Migrations to be applied:`. Anything else is treated as unreadable so the
 * deploy stops instead of assuming the schema matches the code.
 */
export function parseMigrationList(output: string): MigrationListParse {
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  if (/Migrations to be applied/i.test(text)) {
    const pending = unique(text.match(MIGRATION_FILE) ?? []);
    if (!pending.length) {
      return {
        ok: false,
        reason: "Wrangler reported pending migrations but no migration file names were found.",
      };
    }
    return { ok: true, pending };
  }
  if (/No migrations to apply/i.test(text)) return { ok: true, pending: [] };
  return {
    ok: false,
    reason: "Could not read wrangler d1 migrations list output.",
  };
}
