export function GET(): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/favicon-32.png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
