import { getRequestAuth, type RequestAuth } from "../../../../../src/lib/auth-session";
import { placeIdParam } from "@halalfood/core/params";
import {
  consumeMediaLinkLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../src/lib/otp-rate-limit";
import {
  d1MediaLinkRepository,
  fetchMediaMetadata,
  parseMediaUrl,
  type MediaLinkRepository,
  type MediaMetadata,
  type ParsedMediaUrl,
} from "../../../../../src/lib/media-links";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function json(body: unknown, status = 200, headers: HeadersInit = noStore()) {
  return Response.json(body, { status, headers });
}

const unavailable = () =>
  json({ error: "Video links are temporarily unavailable. Please try again." }, 503);

export type MediaRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeLimits?: typeof consumeMediaLinkLimits;
  repository?: MediaLinkRepository;
  fetchMetadata?: (parsed: ParsedMediaUrl) => Promise<MediaMetadata>;
};

export async function handleMediaGet(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: MediaRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return json({ error: "Invalid place id." }, 400);
  try {
    const repository = dependencies.repository ?? d1MediaLinkRepository();
    if (!(await repository.hasPlace(placeId)))
      return json({ error: "That halal place could not be found." }, 404);
    return json({ links: await repository.list(placeId) }, 200, {
      "Cache-Control": "public, max-age=60",
    });
  } catch {
    return unavailable();
  }
}

export async function handleMediaPost(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: MediaRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return json({ error: "Invalid place id." }, 400);

  const auth = await (dependencies.getAuth ?? getRequestAuth)(request);
  if (auth.status === "unavailable") return unavailable();
  if (auth.status === "unauthenticated")
    return json(
      {
        error: "Sign in to share a video.",
        loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
      },
      401,
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a valid JSON object." }, 400);
  }
  const url =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).url
      : undefined;
  const parsed = parseMediaUrl(url);
  if (!parsed)
    return json(
      { error: "Paste a link to an Instagram post or reel, a TikTok video or a YouTube video." },
      400,
    );

  try {
    const repository = dependencies.repository ?? d1MediaLinkRepository();
    if (!(await repository.hasPlace(placeId)))
      return json({ error: "That halal place could not be found." }, 404);

    const decision = await (dependencies.consumeLimits ?? consumeMediaLinkLimits)(
      auth.userId,
      getClientIp(request),
    );
    if (!decision.allowed) {
      const seconds = retryAfterSeconds(decision.retryAfterMs);
      return json({ error: "Too many links shared. Please try again later." }, 429, {
        ...noStore(),
        "Retry-After": String(seconds),
      });
    }

    const metadata = await (dependencies.fetchMetadata ?? fetchMediaMetadata)(parsed);
    const created = await repository.create(auth.userId, placeId, parsed, metadata);
    return json(
      {
        created,
        link: {
          platform: parsed.platform,
          url: parsed.url,
          authorHandle: metadata.handle,
          authorName: metadata.authorName,
          title: metadata.title,
          thumbnailUrl: metadata.thumbnailUrl,
        },
      },
      created ? 201 : 200,
    );
  } catch {
    return unavailable();
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleMediaGet(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleMediaPost(request, context);
}
