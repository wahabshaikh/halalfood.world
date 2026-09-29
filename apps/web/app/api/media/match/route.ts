import { STATUS_COPY } from "@halalfood/core/halal-taxonomy";
import { assessPlaces } from "../../../../src/lib/feed-repository";
import { creatorPath, fetchMediaMetadata, parseMediaUrl } from "../../../../src/lib/media-links";
import { database } from "../../../../src/db";
import { matchPlacesForCaption } from "../../../../src/lib/media-match-repository";
import { consumeMediaMatchLimits } from "../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

/**
 * Work out which place a pasted Instagram, TikTok or YouTube link is about.
 *
 * We read only the platform's public oEmbed data (the caption and creator) and
 * suggest listed places whose names appear in it. The diner always confirms, and
 * nothing is saved here. Instagram gives us no caption, so it never matches and
 * the diner searches instead.
 */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/paste");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseMediaUrl((body as { url?: unknown } | null)?.url);
  if (!parsed)
    return badRequest(
      "Paste a link to an Instagram post or reel, a TikTok video or a YouTube video.",
    );

  const limited = await spendBudget(consumeMediaMatchLimits, outcome.auth);
  if (limited) return limited;

  try {
    const metadata = await fetchMediaMetadata(parsed);
    const caption = metadata.title ?? "";
    const matches = await matchPlacesForCaption(caption);
    const assessed = await assessPlaces(
      matches.map((match) => match.id),
      database(),
    );
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
      matches: matches.map((match) => {
        const status = assessed.get(match.id)?.status ?? "unverified";
        return {
          id: match.id,
          name: match.name,
          citySlug: match.citySlug,
          address: match.streetAddress,
          confidence: match.confidence,
          status,
          statusLabel: STATUS_COPY[status].label,
        };
      }),
    });
  } catch {
    return unavailable();
  }
}
