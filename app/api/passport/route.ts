import { buildFoodPassport, buildMilestones } from "../../../src/lib/food-passport";
import { listPassportVisits, listVisitedPlaces } from "../../../src/lib/visits";
import { listContributions } from "../../../src/lib/contributions-repository";
import { json, requireUser, unavailable } from "../../../src/lib/api";

/** The signed-in user's food passport: coverage, milestones and visited places. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/passport");
  if (!outcome.ok) return outcome.response;

  try {
    const [visits, places, contributions] = await Promise.all([
      listPassportVisits(outcome.auth.userId),
      listVisitedPlaces(outcome.auth.userId),
      listContributions(outcome.auth.userId),
    ]);
    const passport = buildFoodPassport(visits);
    const accepted = (kind: string) =>
      contributions.filter((row) => row.kind === kind && row.status === "accepted")
        .length;
    const milestones = buildMilestones({
      passport,
      acceptedEvidence: accepted("evidence"),
      acceptedCorrections: accepted("edit"),
      reverifiedStalePlaces: 0,
    });
    return json({ passport, milestones, places });
  } catch {
    return unavailable();
  }
}
