import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { citySlugParam } from "@/lib/core/params";
import { EATING_CITY_COOKIE, safeNextPath } from "@/lib/eating-city";

/** Saves the city from "Where are you eating?" and returns to the page that asked. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = citySlugParam(url.searchParams.get("city"));
  const clear = url.searchParams.get("clear") === "1";
  const next = safeNextPath(url.searchParams.get("next"));
  const jar = await cookies();
  if (clear) jar.delete(EATING_CITY_COOKIE);
  else if (city)
    jar.set(EATING_CITY_COOKIE, city, {
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
      sameSite: "lax",
      httpOnly: false,
    });
  return NextResponse.redirect(new URL(next, url.origin), 303);
}
