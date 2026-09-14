import { getRequestAuth } from "../../../../src/lib/auth-session";
import {
  neonSavedPlaceRepository,
} from "../../../../src/lib/saved-places";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized() {
  return Response.json(
    {
      error: "Sign in to view saved places.",
      loginUrl: "/login?returnTo=%2Fsaved",
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
  if (auth.status === "unauthenticated") return unauthorized();

  try {
    return Response.json(await neonSavedPlaceRepository().list(auth.userId), {
      headers: noStore(),
    });
  } catch {
    return unavailable();
  }
}
