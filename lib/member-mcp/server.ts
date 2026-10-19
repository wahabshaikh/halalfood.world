import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { citySlugParam, placeIdParam } from "@/lib/core/params";
import { database } from "@/lib/db";
import { getPlaceById, searchPlaces, type PlaceCard } from "@/lib/places";

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

/** Public reads only, with a fresh MCP server per request and no session or admin token. */
export const MEMBER_MCP_READ_LIMITER_BINDING = "MEMBER_MCP_READ_LIMITER";
export type ReadLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export async function handleMemberRequest(request: Request, client = database, limiter?: ReadLimiter): Promise<Response> {
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

  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: "halalfood-world", version: "1.0.0" },
      {
        instructions:
          "halalfood.world is read-only for now. Halal status comes from community checks and reviewed documents. " +
          "Individual facts can include web or map listing context; unknown facts are null. Confirmed means all four facts are settled, not necessarily favourable. " +
          "Use targeted searches and canonical place links. Data must not be scraped in bulk.",
      },
    );
    async function safely(run: () => Promise<ReturnType<typeof reply>>) {
      try {
        return await run();
      } catch {
        return failure("unavailable", "Places are temporarily unavailable. Please try again.");
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
    return server;
  });
  const response = await handler.fetch(new Request(request, { body: body.slice(0, size) }));
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
