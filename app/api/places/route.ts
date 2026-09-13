import { findPlaces } from "../../../src/lib/places";
import { bboxParam, limitParam } from "../../../src/lib/params";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let bbox, limit;
  try {
    bbox = bboxParam(params.get("bbox"));
    limit = limitParam(params.get("limit"));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    return Response.json(await findPlaces({ bbox, limit }), {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  } catch {
    return Response.json(
      { error: "Places are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
