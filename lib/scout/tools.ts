/**
 * The Halal Food Scout tools. The endpoint has already checked the bearer
 * secret before any of these run (lib/scout/mcp.ts); writes also spend the
 * per-token rate limit, one unit per item.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { BATCH_CONCURRENCY, KeyedLock, MAX_BATCH, mapBounded } from "./batch";
import { creatorHandle } from "@/lib/core/creators";
import { slugifyCity } from "@/lib/core/place-submission";
import { upsertCreator, upsertCreatorInput, type UpsertCreatorInput } from "./creators";
import type { ScoutDeps } from "./deps";
import { allowWrites, WRITE_LIMIT, WRITE_PERIOD_SECONDS, type WriteLimiter } from "./limits";
import { findPlace, findPlaceInput, upsertPlace, upsertPlaceInput, type UpsertPlaceInput } from "./places";
import { addVerification, addVerificationInput, removeVerification, removeVerificationInput, type AddVerificationInput } from "./verifications";

type Failure = { ok: false; error: string; message: string };
type Outcome = { ok: boolean };
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function reply(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) };
}

const rateLimited = (): Failure => ({
  ok: false,
  error: "rate_limited",
  message: `Over ${WRITE_LIMIT} writes per ${WRITE_PERIOD_SECONDS}s for this token. Retry this item after a minute.`,
});

function internal(error: unknown): Failure {
  // The database's or the runtime's message only; never the request or its headers.
  console.error(JSON.stringify({ message: "mcp_scout_write_failed", error: error instanceof Error ? error.message.slice(0, 300) : String(error) }));
  return { ok: false, error: "internal_error", message: "The write failed on the server. It is safe to retry." };
}

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export type ScoutContext = {
  deps: () => Promise<ScoutDeps>;
  tokenId: string;
  limiter?: WriteLimiter;
};

export const TOOL_NAMES = [
  "find_place",
  "upsert_creator",
  "upsert_creators",
  "upsert_place",
  "upsert_places",
  "add_verification",
  "add_verifications",
  "remove_verification",
] as const;

export function registerScoutTools(server: McpServer, context: ScoutContext) {
  async function safely<R extends Outcome>(run: () => Promise<R>): Promise<R | Failure> {
    try {
      return await run();
    } catch (error) {
      return internal(error);
    }
  }

  /** One write: spend one unit, run it, reply with isError when it failed. */
  async function single<R extends Outcome>(run: (deps: ScoutDeps) => Promise<R>): Promise<ToolResult> {
    if ((await allowWrites(context.limiter, context.tokenId, 1)) < 1) return reply(rateLimited(), true);
    const result = await safely(async () => run(await context.deps()));
    return reply(result, !result.ok);
  }

  /** A batch: one unit per item, items over the limit come back rate_limited, items sharing a key run in order. */
  async function batch<T, R extends Outcome & { result?: string }>(items: readonly T[], keys: (item: T) => string[], run: (deps: ScoutDeps, item: T) => Promise<R>) {
    const allowed = await allowWrites(context.limiter, context.tokenId, items.length);
    const deps = await context.deps();
    const lock = new KeyedLock();
    const results = await mapBounded(items, BATCH_CONCURRENCY, async (item, index) =>
      index >= allowed ? rateLimited() : lock.run(keys(item), () => safely(() => run(deps, item))),
    );
    const tally: Record<string, number> = { failed: 0 };
    for (const result of results) {
      const key = result.ok ? ((result as { result?: string }).result ?? "ok") : "failed";
      tally[key] = (tally[key] ?? 0) + 1;
    }
    return reply({ ok: true, summary: tally, results: results.map((result, index) => ({ index, ...result })) });
  }

  const creatorKeys = (item: UpsertCreatorInput) => {
    const handle = creatorHandle(item.handle);
    return [`ch:${item.channel_id}`, ...(handle.ok ? [`h:${handle.handle}`] : [])];
  };
  // Same city, one at a time: a batch can't list the same place twice.
  const placeKeys = (item: UpsertPlaceInput) => [...(item.place_id ? [`p:${item.place_id}`] : []), `city:${slugifyCity(item.city)}`, ...(item.google_place_id ? [`g:${item.google_place_id}`] : [])];
  const verificationKeys = (item: AddVerificationInput) => [`cr:${item.creator.trim().replace(/^@/, "").toLowerCase()}`];

  server.registerTool(
    "find_place",
    {
      title: "Find a place",
      description:
        "Ranked candidates for a place by name near a location: send city (and country) and/or lat+lng with radius_m (default 300 m, max 2 km). " +
        "Each candidate has id, name, address, city, country, lat/lng, distance_m, url, score and matched_by. " +
        "A score at or above same_place_score is treated as the same place by upsert_place. Read-only.",
      inputSchema: findPlaceInput,
      annotations: READ,
    },
    async (input) => {
      const result = await safely(async () => findPlace(await context.deps(), input));
      return reply(result, !result.ok);
    },
  );

  server.registerTool(
    "upsert_creator",
    {
      title: "Create or update a creator",
      description:
        "Create or update an unclaimed, claimable creator profile at /u/<handle> from a YouTube channel. The channel_id is the identity: " +
        "a known channel is updated (its handle follows the YouTube handle when that is free). The handle must fit halalfood.world handles " +
        "(3–30 of a–z, 0–9, _ and .; no hyphens), or the call fails with invalid_handle. A claimed profile, or a handle that belongs to a person " +
        "who signed up, is never changed: result is claimed. Nobody can sign in as an unclaimed creator.",
      inputSchema: upsertCreatorInput,
      annotations: WRITE,
    },
    async (input) => single((deps) => upsertCreator(deps, input)),
  );

  server.registerTool(
    "upsert_creators",
    {
      title: "Create or update creators (batch)",
      description: `Batch upsert_creator: up to ${MAX_BATCH} creators, one result per item in input order, plus a summary. Each item counts once against the rate limit.`,
      inputSchema: z.object({ creators: z.array(upsertCreatorInput).min(1).max(MAX_BATCH) }),
      annotations: WRITE,
    },
    async ({ creators }) => batch(creators, creatorKeys, upsertCreator),
  );

  server.registerTool(
    "upsert_place",
    {
      title: "Find or list a place",
      description:
        "Match first (Google place id, then the find_place ranking within 300 m and the city); a match at same_place_score or above " +
        "returns result: matched, fills empty columns and repairs eligible Scout coordinates. Otherwise lists a new place at once as Not checked yet. " +
        "force_new: true skips matching (a stall inside a food hall that matched the hall); an identical city + name + street address, " +
        "or a Google id already listed, returns error: duplicate_place with existing_place_id. " +
        "lat/lng are optional: without them the place is geocoded once from address, city and country (or its google_place_id) with " +
        "halalfood.world's Google key and daily cap, and stored without coordinates when that isn't confident (no map pin until fixed; " +
        "never a guessed point). location says provided, geocoded, existing, relocated (with previous/current) or null, with geocode giving the reason. " +
        "Optional sourced attributes halal_certified (with certifier_name), muslim_owned, no_pork and no_alcohol, each " +
        "{ value: yes | no | unknown, source_url: https URL, required for yes/no }, are stored as web claims: they fill facts nobody has answered " +
        "and replace Scout's own earlier claims, never override community checks or approved certificates and menus, and \"unknown\" withdraws Scout's earlier claim. " +
        "The result's attributes says per attribute sent: set, updated, unchanged, kept_existing or cleared. " +
        "Refuses Ahmadiyya places and alcohol-led places (pubs, bars, breweries, wine bars) with error: rejected and a reason; " +
        "no_alcohol: no (serves alcohol) alone is not a reason to refuse a restaurant. " +
        "Never settles a fact or changes a place's Verified / n of 3 checks status." +
        " relocate: true explicitly repairs an eligible Scout pin; place_id targets an existing row when correcting its address would defeat matching. Protected sources cannot be relocated.",
      inputSchema: upsertPlaceInput,
      annotations: WRITE,
    },
    async (input) => single((deps) => upsertPlace(deps, input)),
  );

  server.registerTool(
    "upsert_places",
    {
      title: "Find or list places (batch)",
      description: `Batch upsert_place: up to ${MAX_BATCH} places, one result per item in input order, plus a summary. Places in the same city run one after another, so a batch never lists a place twice.`,
      inputSchema: z.object({ places: z.array(upsertPlaceInput).min(1).max(MAX_BATCH) }),
      annotations: WRITE,
    },
    async ({ places }) => batch(places, placeKeys, upsertPlace),
  );

  server.registerTool(
    "add_verification",
    {
      title: "Record that a creator verified a place",
      description:
        "Record that a creator (by @handle or channel id) showed a place in a YouTube video, with an optional timestamp (83 or \"1:23\") and publish date. " +
        "Idempotent per creator, place and video: a repeat returns result: matched (or updated when it adds a timestamp or date). " +
        "Shows on the creator's profile and the place's page as \"Verified by <creator> in a video\" and adds the video to the place's Videos. " +
        "It is context only: it never changes halal status. Refused for alcohol-led or Ahmadiyya places.",
      inputSchema: addVerificationInput,
      annotations: WRITE,
    },
    async (input) => single((deps) => addVerification(deps, input)),
  );

  server.registerTool(
    "add_verifications",
    {
      title: "Record creator verifications (batch)",
      description: `Batch add_verification: up to ${MAX_BATCH} verifications, one result per item in input order, plus a summary.`,
      inputSchema: z.object({ verifications: z.array(addVerificationInput).min(1).max(MAX_BATCH) }),
      annotations: WRITE,
    },
    async ({ verifications }) => batch(verifications, verificationKeys, addVerification),
  );

  server.registerTool(
    "remove_verification",
    {
      title: "Remove a creator verification",
      description:
        "Remove a verification, by id or by creator + place_id + video_url, for corrections. Also removes the video link it added (not one a person added). " +
        "Idempotent: removing one that isn't there returns removed: false.",
      inputSchema: removeVerificationInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => single((deps) => removeVerification(deps, input)),
  );
}
