import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { citySlugParam, placeIdParam } from "@/lib/core/params";
import { validateVouch, VOUCH_RATINGS } from "@/lib/core/contributions";
import { verifyMemberKey } from "@/lib/member-keys";
import { consumeVouchLimits, consumeVouchRatingLimits, d1OtpRateLimitStore, memberContributionLimits } from "@/lib/otp-rate-limit";
import { vouchForPlace, rateVouch } from "@/lib/vouches";
import { database } from "@/lib/db";
import { getPlaceById, searchPlaces, type PlaceCard } from "@/lib/places";
import { memberIdentity, memberContributions } from "./member";

export const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers: { ...NO_STORE, ...headers } });
}

/** Only POST carries this stateless MCP transport. */
export function methodNotAllowed(): Response {
  return rpcError(405, -32000, "Method not allowed. The member endpoint takes JSON-RPC over POST.", { Allow: "POST" });
}

function publicPlace(place: PlaceCard) {
  return {
    id: place.id,
    name: place.name,
    city: place.citySlug,
    area: place.area,
    cuisine: place.cuisine,
    status: place.status,
    facts: { owned: place.facts.owned, certified: place.facts.certified, pork: place.facts.pork, alcohol: place.facts.alcohol },
    url: `https://halalfood.world/place/${place.id}`,
  };
}

function reply(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(isError ? { isError } : {}) };
}

function failure(error: string, message: string) {
  return reply({ ok: false, error, message }, true);
}

/** A fresh server per request keeps authenticated tool discovery isolated between members. */
export const MEMBER_MCP_READ_LIMITER_BINDING = "MEMBER_MCP_READ_LIMITER";
export const MEMBER_MCP_WRITE_LIMITER_BINDING = "MEMBER_MCP_WRITE_LIMITER";
const MEMBER_TOOLS = ["whoami", "my_contributions", "verify_place", "rate_place"];
export type ReadLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export async function handleMemberRequest(request: Request, client = database, limiter?: ReadLimiter, writeLimiter?: ReadLimiter): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  if (limiter) {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const allowed = await limiter.limit({ key: `member-mcp:${ip}` }).then((result) => result.success, () => true);
    if (!allowed) return rpcError(429, -32000, "Too many requests. Try again in a minute.", { "Retry-After": "60" });
  }
  const tooLarge = () => rpcError(413, -32600, "Request bodies are at most 64 KB.");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return tooLarge();

  // Count streamed bytes too: Content-Length can be absent or understate the body.
  const reader = request.body?.getReader();
  const body = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > MAX_BODY_BYTES) {
          await reader.cancel();
          return tooLarge();
        }
        body.set(value, size);
        size += value.byteLength;
      }
    } catch {
      return rpcError(400, -32600, "The request body could not be read.");
    } finally {
      reader.releaseLock();
    }
  }

  const authorization = request.headers.get("authorization");
  let member;
  try {
    member = authorization && /^Bearer\s+\S+$/i.test(authorization)
      ? await verifyMemberKey(authorization, await client()) : null;
  } catch {
    return rpcError(503, -32000, "Member authentication is temporarily unavailable. Please try again.");
  }
  const canWrite = member?.scopes.includes("write");
  // Hidden tools still give a useful auth error when called directly.
  let call;
  try { call = JSON.parse(new TextDecoder().decode(body.slice(0, size))); } catch { /* The SDK handles malformed JSON. */ }
  if (!canWrite && call?.method === "tools/call" && MEMBER_TOOLS.includes(call.params?.name)) {
    return Response.json({ jsonrpc: "2.0", id: call.id ?? null, result: failure("unauthorized", "Use Authorization: Bearer <member key> with the write scope. Create a key at /me/keys.") }, { headers: NO_STORE });
  }

  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: "halalfood-world", version: "1.0.0" },
      {
        instructions:
          "Anonymous tools are read-only. Member tools require a member key with write scope. Halal status comes from community checks and reviewed documents. " +
          "Individual facts can include web or map listing context; unknown facts are null. Confirmed means all four facts are settled, not necessarily favourable. " +
          "Use targeted searches and canonical place links. Data must not be scraped in bulk. " +
          "Only submit data the member saw or that comes from the restaurant's own or open public pages. " +
          "Never scrape Zomato, Swiggy or Google Maps. Contributions are reviewed.",
      },
    );
    async function safely(run: () => Promise<ReturnType<typeof reply>>) {
      try {
        return await run();
      } catch {
        return failure("unavailable", "Member tools are temporarily unavailable. Please try again.");
      }
    }
    server.registerTool("search_places", {
      description: "Search listed places by name, cuisine or area. City is a slug that prioritizes nearby results, not a strict filter. Read-only; no bulk scraping.",
      inputSchema: z.object({
        q: z.string().trim().min(1).max(64),
        city: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
        limit: z.number().int().min(1).max(10).default(10),
      }),
      annotations: READ,
    }, async ({ q, city, limit }) => safely(async () => {
      const places = await searchPlaces(q, { citySlug: citySlugParam(city), limit }, await client());
      return reply({ places: places.map(publicPlace) });
    }));
    server.registerTool("get_place", {
      description: "Get one listed place's public details and four halal facts by id. Read-only.",
      inputSchema: z.object({ id: z.string() }),
      annotations: READ,
    }, async ({ id }) => {
      const parsed = placeIdParam(id);
      if (!parsed) return failure("invalid_id", "Invalid place id.");
      return safely(async () => {
        const place = await getPlaceById(parsed, await client());
        return place ? reply({ place: publicPlace(place.card) }) : failure("not_found", "That place could not be found.");
      });
    });
    if (canWrite && member) {
      const identity = member;
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const source = { channel: "mcp" as const, ip, apiKeyId: identity.keyId };
      const limits = async () => memberContributionLimits(identity.userId, client());
      server.registerTool("whoami", {
        description: "Your member id, trust tier and daily user limits remaining. Requires write scope.",
        inputSchema: z.object({}).strict(), annotations: READ,
      }, async () => safely(async () => reply({ ...await memberIdentity(identity.userId, await client()), limits_remaining: await limits() })));
      server.registerTool("my_contributions", {
        description: "Your ten most recent contributions and their review status. Requires write scope.",
        inputSchema: z.object({}).strict(), annotations: READ,
      }, async () => safely(async () => reply({ contributions: await memberContributions(identity.userId, await client()), limits_remaining: await limits() })));
      async function spend(rating: boolean) {
        // A missing binding or limiter failure must never bypass the write budget.
        if (!writeLimiter) return failure("unavailable", "Member writes are temporarily unavailable. Please try again.");
        if (!(await writeLimiter.limit({ key: `member-mcp-write:${identity.keyId}` })).success)
          return failure("rate_limited", "Too many writes. Try again in a minute.");
        const consume = rating ? consumeVouchRatingLimits : consumeVouchLimits;
        const decision = await consume(identity.userId, ip, d1OtpRateLimitStore(client()));
        return decision.allowed ? null : failure("rate_limited", "Your contribution budget is exhausted or cooling down. Please try again later.");
      }
      const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
      server.registerTool("verify_place", {
        description: "Vouch that you ate here. Same limits, points and review as the web vouch; no halal fact check is submitted.",
        inputSchema: z.object({ place_id: z.string(), ate_at: z.string().optional(), rating: z.enum(VOUCH_RATINGS).optional(), note: z.string().optional() }).strict(),
        annotations: WRITE,
      }, async ({ place_id, ate_at, rating, note }) => safely(async () => {
        const id = placeIdParam(place_id);
        if (!id) return failure("invalid_id", "Invalid place id.");
        const parsed = validateVouch({ ateAt: ate_at, rating, note });
        if (!parsed.ok) return failure("invalid_input", parsed.error);
        const limited = await spend(false);
        if (limited) return limited;
        const result = await vouchForPlace(identity.userId, id, parsed.value, source, client());
        if (!result.ok) return failure(result.status === 429 ? "rate_limited" : "not_found", result.error);
        const { contributionId, status, points, trust } = result.value;
        return reply({ contribution_id: contributionId, status, points,
          trust: { score: trust.trustScore, band: trust.trustBand, communityVouchers: trust.communityVouchers }, limits_remaining: await limits() });
      }));
      server.registerTool("rate_place", {
        description: "Change only the rating on your existing vouch. No points, halal fact changes or new vouch.",
        inputSchema: z.object({ place_id: z.string(), rating: z.enum(VOUCH_RATINGS) }).strict(), annotations: WRITE,
      }, async ({ place_id, rating }) => safely(async () => {
        const id = placeIdParam(place_id);
        if (!id) return failure("invalid_id", "Invalid place id.");
        const limited = await spend(true);
        if (limited) return limited;
        const result = await rateVouch(identity.userId, id, rating, source, client());
        return result.ok ? reply({ ...result, limits_remaining: await limits() }) : failure("not_found", result.error);
      }));
    }
    return server;
  });
  // Build the forwarded request from plain fields: in production the route's request is not a native Request,
  // and `new Request(request, …)` stringified it ("Invalid URL: [object Request]", a 500 on every call).
  const forwarded = new Request(request.url, { method: "POST", headers: request.headers, body: body.slice(0, size) });
  const response = await handler.fetch(forwarded);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
