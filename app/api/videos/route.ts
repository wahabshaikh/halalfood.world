import { youtubeVideoId } from "@/lib/core/creators";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { consumeVideoPasteLimits } from "@/lib/otp-rate-limit";
import { getPlaceById } from "@/lib/places";
import { pasteVideo, videoDeps } from "@/lib/videos";

/**
 * Paste a YouTube video (spec §5.1). Body `{url}`. Returns the cached video,
 * its creator and places named in its title or description; the member then
 * picks places with POST /api/videos/[id]/places. Metadata is fetched once
 * per video and cached for 30 days.
 */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/add/video");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const videoId = youtubeVideoId((body as { url?: unknown } | null)?.url);
  if (!videoId) return badRequest("Paste a YouTube video or Short link.");
  const limited = await spendBudget(consumeVideoPasteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await pasteVideo(outcome.auth.userId, videoId, await videoDeps(request));
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    const { suggestions, ...video } = result.value;
    const places = await Promise.all(suggestions.map((match) => getPlaceById(match.id)));
    return json({
      ...video,
      suggestions: places.flatMap((place, index) =>
        place ? [{ id: place.id, name: place.name, address: suggestions[index].streetAddress, status: place.card.status }] : [],
      ),
    });
  } catch {
    return unavailable();
  }
}
