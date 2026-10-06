import { getRequestAuth } from "@/lib/auth-session";
import {
  d1SavedPlaceRepository,
} from "@/lib/saved-places";
import { signedOutLoginPath, hasSessionCookie } from "@/lib/signed-out";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(hadSession: boolean) {
  return Response.json(
    {
      error: "Sign in to view saved places.",
      loginUrl: signedOutLoginPath("/saved", hadSession),
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Saved places are temporarily unavailable. Please try again." },
    { status: 503, headers: noStore() },
  );
}

export async function GET(request: Request) {
  const auth = await getRequestAuth(request);
  if (auth.status === "unavailable") return unavailable();
  if (auth.status === "unauthenticated") return unauthorized(hasSessionCookie(request));

  try {
    return Response.json(await d1SavedPlaceRepository().list(auth.userId), {
      headers: noStore(),
    });
  } catch {
    return unavailable();
  }
}
