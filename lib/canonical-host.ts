/** A 308 to the apex for www.halalfood.world, pages and /api alike; null for every other host. */
export function canonicalRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== "www.halalfood.world") return null;
  url.hostname = "halalfood.world";
  return Response.redirect(url.toString(), 308);
}
