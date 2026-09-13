import { getPlaceById } from "../../../../src/lib/places";
import { placeIdParam } from "../../../../src/lib/params";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = placeIdParam((await params).id);
  if (!id) return Response.json({ error: "Invalid place id" }, { status: 400 });
  try {
    const place = await getPlaceById(id);
    if (!place) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(place, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return Response.json(
      { error: "Places are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
