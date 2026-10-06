import { creatorPath, fetchMediaMetadata, parseMediaUrl } from "@/lib/media-links";
import { matchPlacesForCaption } from "@/lib/media-match-repository";
import { consumeMediaMatchLimits } from "@/lib/otp-rate-limit";
import { getPlaceById } from "@/lib/places";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";

/**
 * Work out which place a pasted Instagram, TikTok or YouTube link is about.
 *
 * We read only the platform's public oEmbed data (the caption and creator) and
 * suggest listed places whose names appear in it. The diner always confirms, and
 * nothing is saved here. Instagram gives us no caption, so it never matches and
 * the diner searches instead.
 */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/add/video");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseMediaUrl((body as { url?: unknown } | null)?.url);
  if (!parsed) return badRequest("Paste a link to an Instagram post or reel, a TikTok video or a YouTube video.");

  const limited = await spendBudget(consumeMediaMatchLimits, outcome.auth);
  if (limited) return limited;

  try {
    const metadata = await fetchMediaMetadata(parsed);
    const caption = metadata.title ?? "";
    const matches = await matchPlacesForCaption(caption);
    const details = await Promise.all(matches.slice(0, 3).map((match) => getPlaceById(match.id)));
    return json({
      link: {
        platform: parsed.platform,
        url: parsed.url,
        authorHandle: metadata.handle,
        authorName: metadata.authorName,
        title: metadata.title,
        thumbnailUrl: metadata.thumbnailUrl,
        creatorPath: metadata.handle ? creatorPath(parsed.platform, metadata.handle) : null,
      },
      readable: caption.length > 0,
      matches: details.flatMap((place, index) =>
        place
          ? [
              {
                id: place.id,
                name: place.name,
                address: matches[index].streetAddress,
                confidence: matches[index].confidence,
                status: place.card.status,
              },
            ]
          : [],
      ),
    });
  } catch {
    return unavailable();
  }
}
