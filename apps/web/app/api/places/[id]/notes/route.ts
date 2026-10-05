import { placeIdParam } from "@halalfood/core/params";
import { badRequest, optionalUser, unavailable } from "../../../../../src/lib/api";
import { listPlaceNotes } from "../../../../../src/lib/checks-repository";

/** "What people said": shared notes, newest first, as the viewer may see them. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = placeIdParam((await params).id);
  if (!id) return badRequest("Invalid place id.");
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || undefined;
  try {
    const viewerId = await optionalUser(request);
    const notes = await listPlaceNotes(id, viewerId, { limit: 10, before });
    return Response.json({ notes }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}
