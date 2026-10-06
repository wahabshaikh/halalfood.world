import { readSink, type SinkDatabase } from "@/lib/email";
import { hostFromRequest } from "@/lib/request-host";
import { isNonProductionRequest, readBinding } from "@/lib/worker-env";

export const dynamic = "force-dynamic";

/** Localhost and Worker Previews only (404 in production): the newest sink mail, optionally for one `to`. */
export async function GET(request: Request) {
  if (!(await isNonProductionRequest(hostFromRequest(request)))) return Response.json({ error: "Not found" }, { status: 404 });
  const database = await readBinding<SinkDatabase>("DB");
  if (!database) return Response.json({ error: "Database is not configured" }, { status: 503 });
  const to = new URL(request.url).searchParams.get("to");
  return Response.json({ messages: await readSink(database, to) }, { headers: { "cache-control": "no-store" } });
}
