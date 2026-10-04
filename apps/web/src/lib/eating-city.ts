import { citySlugParam } from "@halalfood/core/params";

/** Cookie set when someone answers "Where are you eating?". */
export const EATING_CITY_COOKIE = "hf_eating_city";

export type EatingCitySource = "choice" | "none";

export type EatingCity = {
  slug: string | null;
  source: EatingCitySource;
};

/**
 * A network or GPS location never becomes the eating city. Only a slug the
 * visitor submitted, and only when that slug is a city we actually list.
 */
export function resolveEatingCity(input: {
  query?: string | null;
  cookie?: string | null;
  cities: readonly { city_slug: string }[];
}): EatingCity {
  const known = new Set(input.cities.map((city) => city.city_slug));
  const query = citySlugParam(input.query);
  if (query && known.has(query)) return { slug: query, source: "choice" };
  const cookie = citySlugParam(input.cookie);
  if (cookie && known.has(cookie)) return { slug: cookie, source: "choice" };
  return { slug: null, source: "none" };
}

/** Alphabetical options for the one-step city control. */
export function eatingCityOptions<T extends { city_slug: string }>(cities: readonly T[]): T[] {
  return [...cities].sort((a, b) => a.city_slug.localeCompare(b.city_slug));
}

/** Redirect target after the city form. Only same-site paths. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  if (value.startsWith("/eating")) return "/";
  return value;
}

export async function readEatingCityCookie(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return citySlugParam(jar.get(EATING_CITY_COOKIE)?.value ?? null);
  } catch {
    return null;
  }
}
