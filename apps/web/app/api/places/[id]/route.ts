import { placeIdParam } from "@halalfood/core/params";
import { badRequest, notFound, optionalUser, unavailable } from "../../../../src/lib/api";
import { decoratePlaces } from "../../../../src/lib/explore";
import { getPlaceById } from "../../../../src/lib/places";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = placeIdParam((await params).id);
  if (!id) return badRequest("Invalid place id.");
  try {
    const place = await getPlaceById(id);
    if (!place) return notFound("That place could not be found.");
    const viewerId = await optionalUser(request);
    const [card] = await decoratePlaces(viewerId, [place.card]);
    return Response.json({ place: card }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}
