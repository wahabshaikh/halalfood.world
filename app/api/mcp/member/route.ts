import { database } from "@/lib/db";
import { handleMemberRequest, MEMBER_MCP_READ_LIMITER_BINDING, MEMBER_MCP_WRITE_LIMITER_BINDING, methodNotAllowed, type ReadLimiter } from "@/lib/member-mcp/server";
import { readBinding } from "@/lib/worker-env";

export const dynamic = "force-dynamic";

/** Public reads and scoped member writes over stateless JSON-RPC. */
export async function POST(request: Request) {
  return handleMemberRequest(request, database, await readBinding<ReadLimiter>(MEMBER_MCP_READ_LIMITER_BINDING), await readBinding<ReadLimiter>(MEMBER_MCP_WRITE_LIMITER_BINDING));
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
