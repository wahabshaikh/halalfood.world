/**
 * Why a Workers Builds run must stop before it uploads anything, or null to carry on.
 *
 * The supported setup builds with `pnpm build` and deploys with `pnpm cf:deploy` (main) or
 * `pnpm cf:preview` (every other branch, a Worker Preview with its own bindings). The settings this
 * repo used before Worker Previews ran `npm run build` then `wrangler versions upload`, which would
 * upload a branch as a version of the production Worker with production D1, R2 and secrets. Those
 * settings are recognisable by npm running the build, so that is refused.
 */
export function buildGuardFailure(env: Record<string, string | undefined>): string | null {
  if (env.WORKERS_CI !== "1") return null;
  const agent = env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm/")) return null;
  return [
    `Workers Builds ran this build with "${agent.split(" ")[0] || "an unknown package manager"}", not pnpm.`,
    "The Worker's build settings are out of date. In the Cloudflare dashboard (Workers & Pages → halalfood-world →",
    "Settings → Builds) set: build command `pnpm build`, deploy command `pnpm cf:deploy`, and turn on Previews",
    "with preview command `pnpm cf:preview`. See docs/deployment.md. Nothing was uploaded.",
  ].join("\n");
}
