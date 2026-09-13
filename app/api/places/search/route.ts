import { findPlaces } from "../../../../src/lib/places";
import { limitParam } from "../../../../src/lib/params";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  let limit;
  try {
    limit = limitParam(params.get("limit"), 40);
    if (q.length < 2 || q.length > 120)
      throw new Error("Search must contain 2–120 characters");
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    return Response.json(await findPlaces({ q, limit }), {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  } catch {
    return Response.json(
      { error: "Search is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
