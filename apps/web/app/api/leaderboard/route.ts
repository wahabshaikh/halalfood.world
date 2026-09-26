import {
  CONTRIBUTOR_LEADERBOARD_CACHE_CONTROL,
  CONTRIBUTOR_SCORE_WEIGHTS,
  listContributors,
} from "../../../src/lib/contributor-leaderboard";

export async function GET() {
  try {
    const contributors = await listContributors();
    return Response.json(
      { contributors, weights: CONTRIBUTOR_SCORE_WEIGHTS },
      { headers: { "Cache-Control": CONTRIBUTOR_LEADERBOARD_CACHE_CONTROL } },
    );
  } catch {
    return Response.json(
      { error: "The contributor leaderboard is temporarily unavailable." },
      { status: 503 },
    );
  }
}
