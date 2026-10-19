/**
 * `X-Robots-Tag: noindex` on the pages of imported places nobody has verified
 * yet, next to the page's own `<meta name="robots">` (app/place/[id]/page.tsx).
 *
 * A page can't set response headers, so the Worker entry asks the database in
 * parallel with the render: one primary-key read, which adds no latency. If the
 * read fails the page still carries its meta tag. Place pages are never
 * edge-cached (lib/public-cache.ts), so a verified place loses the header on
 * its next request.
 */
import { placeIdParam } from "@/lib/core/params";

export const NOINDEX = "noindex";

/** The place id of a `/place/<uuid>` page (not its sub-pages), or null. */
export function placePageId(request: Request): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const match = /^\/place\/([^/]+)\/?$/.exec(new URL(request.url).pathname);
  return match ? placeIdParam(match[1]) : null;
}

/** Add `X-Robots-Tag: noindex` to an HTML place page when `isUnverified(id)` says so. */
export async function withPlaceRobotsHeader(
  request: Request,
  load: () => Promise<Response>,
  isUnverified: (placeId: string) => Promise<boolean>,
): Promise<Response> {
  const id = placePageId(request);
  if (!id) return load();
  const [response, unverified] = await Promise.all([load(), isUnverified(id).catch(() => false)]);
  if (!unverified || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", NOINDEX);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
