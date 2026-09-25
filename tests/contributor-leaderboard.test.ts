import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anonymizedContributorHandle,
  CONTRIBUTOR_SCORE_WEIGHTS,
  contributorDisplayName,
  getContributorLeaderboard,
  rankContributors,
  scoreContributor,
  type ContributorAggregate,
} from "../src/lib/contributor-leaderboard";

function counts(
  overrides: Partial<ContributorAggregate["contributions"]> = {},
): ContributorAggregate["contributions"] {
  return {
    placesAdded: 0,
    verificationsSubmitted: 0,
    reviews: 0,
    photos: 0,
    ratings: 0,
    ...overrides,
  };
}

test("contributor weights and score formula stay explicit", () => {
  assert.deepEqual(CONTRIBUTOR_SCORE_WEIGHTS, {
    placesAdded: 10,
    verificationsSubmitted: 8,
    reviews: 5,
    photos: 3,
    ratings: 1,
  });
  assert.equal(
    scoreContributor(
      counts({
        placesAdded: 2,
        verificationsSubmitted: 3,
        reviews: 4,
        photos: 5,
        ratings: 6,
      }),
    ),
    2 * 10 + 3 * 8 + 4 * 5 + 5 * 3 + 6,
  );
});

test("fixture contributions are ranked by total score", () => {
  const ranked = rankContributors([
    {
      userId: "user-low",
      name: "Zayd",
      contributions: counts({ reviews: 1, photos: 1 }),
    },
    {
      userId: "user-high",
      name: "Aisha",
      contributions: counts({ placesAdded: 1, reviews: 2, ratings: 1 }),
    },
    {
      userId: "user-middle",
      name: "Maryam",
      contributions: counts({ verificationsSubmitted: 1, reviews: 1 }),
    },
  ]);

  assert.deepEqual(ranked.map((entry) => entry.displayName), [
    "Aisha",
    "Maryam",
    "Zayd",
  ]);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 3]);
  assert.equal(ranked[0].score, 21);
});

test("ties use more places, then name, then a stable id", () => {
  const ranked = rankContributors([
    {
      userId: "z-user",
      name: "Zayd",
      contributions: counts({ placesAdded: 1, ratings: 10 }),
    },
    {
      userId: "a-user",
      name: "Aisha",
      contributions: counts({ placesAdded: 1, ratings: 10 }),
    },
    {
      userId: "more-places",
      name: "Zainab",
      contributions: counts({ placesAdded: 2 }),
    },
    {
      userId: "fewer-places",
      name: "Bilal",
      contributions: counts({ reviews: 2, photos: 0, ratings: 0 }),
    },
  ]);

  assert.deepEqual(ranked.map((entry) => entry.displayName), [
    "Zainab",
    "Aisha",
    "Zayd",
    "Bilal",
  ]);
  assert.equal(
    rankContributors([
      {
        userId: "z-user",
        name: "Same",
        contributions: counts({ reviews: 2 }),
      },
      {
        userId: "a-user",
        name: "Same",
        contributions: counts({ reviews: 2 }),
      },
    ])[0].displayName,
    "Same",
  );
  const stableTie = rankContributors([
    {
      userId: "z-user",
      name: null,
      contributions: counts({ reviews: 2 }),
    },
    {
      userId: "a-user",
      name: null,
      contributions: counts({ reviews: 2 }),
    },
  ]);
  assert.equal(stableTie[0].displayName, anonymizedContributorHandle("a-user"));
});

test("empty names receive an anonymized contributor handle", () => {
  const handle = anonymizedContributorHandle("user-123");
  assert.match(handle, /^Contributor · [0-9a-f]{4}$/);
  assert.equal(contributorDisplayName("   ", "user-123"), handle);
  assert.equal(contributorDisplayName(" Amina ", "user-123"), "Amina");
  assert.doesNotMatch(handle, /user-123/);
});

test("leaderboard ranking uses an injectable repository", async () => {
  let receivedLimit = 0;
  const ranked = await getContributorLeaderboard(
    {
      async list(limit) {
        receivedLimit = limit;
        return [
          {
            userId: "mock-user",
            name: null,
            contributions: counts({ placesAdded: 1 }),
          },
        ];
      },
    },
    7,
  );

  assert.equal(receivedLimit, 7);
  assert.equal(ranked[0].score, 10);
  assert.match(ranked[0].displayName, /^Contributor · /);
});

test("contributor levels follow score thresholds", async () => {
  const { contributorLevel, nextContributorLevel } = await import("../src/lib/contributor-leaderboard");
  assert.equal(contributorLevel(0).name, "Newcomer");
  assert.equal(contributorLevel(49).name, "Newcomer");
  assert.equal(contributorLevel(50).name, "Regular");
  assert.equal(contributorLevel(250).name, "Trusted");
  assert.equal(contributorLevel(10_000).name, "Keeper");
  assert.equal(contributorLevel(Number.NaN).name, "Newcomer");
  assert.deepEqual(nextContributorLevel(180)?.pointsToGo, 20);
  assert.equal(nextContributorLevel(180)?.level.name, "Trusted");
  assert.equal(nextContributorLevel(700), null);
});
