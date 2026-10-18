/**
 * Write rate limit for the Scout endpoint, per admin token, on the Workers
 * Rate Limiting binding `MCP_WRITE_LIMITER` (wrangler.jsonc: 300 per 60 s).
 * Each item in a call costs one, so a batch of 25 uses 25. The binding counts
 * per Cloudflare location and is eventually consistent: a guard against a
 * runaway importer, not an exact quota.
 */

export const MCP_WRITE_LIMITER_BINDING = "MCP_WRITE_LIMITER";
export const MCP_WRITE_LIMITER_NAMESPACE = "81003";
export const PREVIEW_MCP_WRITE_LIMITER_NAMESPACE = "81103";
export const WRITE_LIMIT = 300;
export const WRITE_PERIOD_SECONDS = 60;

export type WriteLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** How many of `cost` writes may go ahead now. Without the binding (unit tests, local dev), all of them. */
export async function allowWrites(limiter: WriteLimiter | undefined, tokenId: string, cost: number): Promise<number> {
  if (!limiter || cost <= 0) return Math.max(0, cost);
  const key = `mcp-write:${tokenId}`;
  const outcomes = await Promise.all(
    Array.from({ length: cost }, () => limiter.limit({ key }).then((result) => result.success, () => false)),
  );
  return outcomes.filter(Boolean).length;
}
