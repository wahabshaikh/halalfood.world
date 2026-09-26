import { getCity } from "../../../../src/lib/places";
import { citySlugParam } from "@halalfood/core/params";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ citySlug: string }> },
) {
  const slug = citySlugParam((await params).citySlug);
  if (!slug) return Response.json({ error: "Invalid city" }, { status: 400 });
  try {
    const city = await getCity(slug);
    if (!city) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(city, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return Response.json(
      { error: "Cities are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
