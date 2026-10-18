import { scoutEnvironment } from "@/lib/scout/environment";
import { handleScoutRequest, methodNotAllowed } from "@/lib/scout/mcp";

export const dynamic = "force-dynamic";

/**
 * Halal Food Scout's admin MCP endpoint (Streamable HTTP, JSON-RPC over POST).
 * Bearer `MCP_ADMIN_SECRET` on every call; see lib/scout/mcp.ts and docs/architecture.md.
 */
export async function POST(request: Request) {
  return handleScoutRequest(request, await scoutEnvironment(request));
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
