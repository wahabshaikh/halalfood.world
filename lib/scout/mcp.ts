/**
 * The admin MCP endpoint for Halal Food Scout: Streamable HTTP, JSON-RPC over
 * POST, stateless (a fresh server per request, no sessions).
 * GET and DELETE answer 405.
 *
 * Every request needs `Authorization: Bearer <MCP_ADMIN_SECRET>`. With no
 * secret (or one under 32 characters) on the Worker the endpoint answers 503;
 * a missing or wrong token gets 401. Nothing about the endpoint is public, not
 * even its tool list.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { checkAdminToken } from "./auth";
import type { ScoutDeps } from "./deps";
import type { WriteLimiter } from "./limits";
import { registerScoutTools } from "./tools";

export const SCOUT_SERVER_NAME = "halalfood-scout";
export const SCOUT_SERVER_VERSION = "1.0.0";
/** A batch of 25 is a few KB; anything this big is not a Scout call. */
export const MAX_BODY_BYTES = 256 * 1024;

export type ScoutEnvironment = {
  secret: unknown;
  limiter?: WriteLimiter;
  deps: () => Promise<ScoutDeps>;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A JSON-RPC error body with an HTTP status, for answers given before the MCP server runs. */
function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers: { ...NO_STORE, ...headers } });
}

export function methodNotAllowed(): Response {
  return rpcError(405, -32000, "Method not allowed. The Scout endpoint takes JSON-RPC over POST.", { Allow: "POST" });
}

export async function handleScoutRequest(request: Request, environment: ScoutEnvironment): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await checkAdminToken(request, environment.secret);
  if (!auth.ok)
    return auth.error === "not_configured"
      ? rpcError(503, -32000, auth.message)
      : rpcError(401, -32001, auth.message, { "WWW-Authenticate": 'Bearer realm="halalfood-scout"' });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return rpcError(413, -32600, `Request bodies are at most ${MAX_BODY_BYTES / 1024} KB.`);

  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: SCOUT_SERVER_NAME, version: SCOUT_SERVER_VERSION },
      {
        instructions:
          "Halal Food Scout: record halal food YouTube creators and the places they verify in their videos. " +
          "Typical flow: upsert_creator, then find_place / upsert_place, then add_verification with the place id. " +
          "For menus: upsert_menu with the place id, then set_menu_check; set_place_logo for its logo. " +
          "Creator verifications, menus and logos are context and never change a place's halal status.",
      },
    );
    registerScoutTools(server, { deps: environment.deps, tokenId: auth.tokenId, limiter: environment.limiter });
    return server;
  });
  const response = await handler.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
