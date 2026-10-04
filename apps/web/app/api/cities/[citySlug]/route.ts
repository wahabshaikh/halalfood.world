import { loadCityRecord } from "../../../../src/lib/places";
import { citySlugParam } from "@halalfood/core/params";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ citySlug: string }> },
) {
  const slug = citySlugParam((await params).citySlug);
  if (!slug) return Response.json({ error: "Invalid city" }, { status: 400 });
  const loaded = await loadCityRecord(slug);
  if (loaded.status === "missing")
    return Response.json({ error: "Not found" }, { status: 404 });
  if (loaded.status === "error")
    return Response.json(
      { error: "Cities are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  return Response.json(loaded.data, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
