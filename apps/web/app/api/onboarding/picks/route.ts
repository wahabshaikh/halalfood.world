import { filtersFromStandards, parseDiscoveryFilters } from "@halalfood/core/discovery-filters";
import { citySlugParam } from "@halalfood/core/params";
import {
  STANDARD_PRESETS,
  applyOnboardingStandard,
  type StandardPreset,
} from "@halalfood/core/social";
import { DEFAULT_PREFERENCES } from "@halalfood/core/user-preferences";
import { discoverPlaces } from "../../../../src/lib/discovery";
import { json, requireUser, unavailable } from "../../../../src/lib/api";

const PICK_COUNT = 8;

/**
 * Places to seed "want to try". Only places that pass the standard chosen in
 * the previous step are offered, so nobody is shown a place that fails their
 * own rules. Each row carries its halal status for the badge.
 */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/onboarding");
  if (!outcome.ok) return outcome.response;

  const params = new URL(request.url).searchParams;
  const preset = params.get("preset") as StandardPreset | null;
  const preferences = applyOnboardingStandard(DEFAULT_PREFERENCES, {
    preset: preset && STANDARD_PRESETS.includes(preset) ? preset : "community",
    avoidAlcohol: params.get("noAlcohol") === "1",
    preferHandSlaughter: false,
  });
  const derived = filtersFromStandards(preferences);
  const base = parseDiscoveryFilters(new URLSearchParams());
  const filters = {
    ...base,
    statuses: derived.statuses,
    facts: derived.facts,
  };

  const citySlug = citySlugParam(params.get("city")) ?? undefined;
  try {
    const result = await discoverPlaces({ filters, citySlug, limit: PICK_COUNT });
    return json({
      places: result.places.map((place) => ({
        id: place.id,
        name: place.name,
        citySlug: place.city_slug,
        neighbourhood: place.neighbourhood ?? null,
        halalStatus: place.halal_status,
      })),
    });
  } catch {
    return unavailable("Places are temporarily unavailable. Please try again.");
  }
}
