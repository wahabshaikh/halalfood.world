import { badRequest, unavailable } from "../../../../src/lib/api";
import { nearestCity } from "../../../../src/lib/places";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!params.get("lat") || !params.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return badRequest("Send lat and lng.");
  try {
    const city = await nearestCity({ lat, lng });
    return Response.json({ city: city?.city_slug ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}
