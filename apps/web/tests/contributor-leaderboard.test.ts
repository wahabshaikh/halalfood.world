import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anonymizedContributorHandle,
  CONTRIBUTOR_SCORE_WEIGHTS,
  contributorDisplayName,
  contributorProfilePath,
  d1ContributorLeaderboardRepository,
  getContributorLeaderboard,
  publicProfileHandle,
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
  assert.equal(
    contributorDisplayName("z4blt7@mail.instinct.com", "user-123"),
    handle,
  );
  assert.doesNotMatch(handle, /user-123/);
});

test("a public profile handle links to /u and a private or invalid one does not", () => {
  assert.equal(publicProfileHandle("Amina_Eats"), "amina_eats");
  assert.equal(publicProfileHandle("not a handle"), null);
  assert.equal(publicProfileHandle("a@b.com"), null);
  assert.equal(contributorProfilePath("amina_eats"), "/u/amina_eats");
  assert.equal(contributorProfilePath(null), null);

  const ranked = rankContributors([
    {
      userId: "public-user",
      name: "Amina",
      profileHandle: "Amina_Eats",
      contributions: counts({ placesAdded: 1 }),
    },
    {
      userId: "anon-user",
      name: null,
      profileHandle: null,
      contributions: counts({ reviews: 1 }),
    },
  ]);
  assert.equal(ranked[0].profileHandle, "amina_eats");
  assert.equal(contributorProfilePath(ranked[0].profileHandle), "/u/amina_eats");
  assert.equal(ranked[1].profileHandle, null);
  assert.equal(contributorProfilePath(ranked[1].profileHandle), null);
});

test("the contributor query exposes a public handle and hides a private one", async () => {
  const { createTestDatabase, addUser } = await import("./support/sqlite-d1");
  const { sqlite, db } = createTestDatabase();
  const now = Date.now();
  addUser(sqlite, "public-user", "public@example.com");
  addUser(sqlite, "private-user", "private@example.com");
  const profile = sqlite.prepare(
    `INSERT INTO user_profiles (
      user_id, handle, display_name, created_at, updated_at, is_private, onboarded_at, show_on_leaderboards
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  profile.run("public-user", "amina_eats", "Amina", now, now, 0, now);
  profile.run("private-user", "hidden_diner", "Hidden", now, now, 1, now);
  const place = sqlite.prepare(
    `INSERT INTO places (
      id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
      scraped_at, created_at, halal_confirmed, submitted_by_user_id, lat, lng
    ) VALUES (?, ?, 'mumbai', 'u', '1 Street', '[]', 'user-submitted', 'u', ?, ?, 1, ?, 1, 1)`,
  );
  place.run("place-public", "Public Kitchen", now, now, "public-user");
  place.run("place-private", "Private Kitchen", now, now, "private-user");

  const ranked = await getContributorLeaderboard(d1ContributorLeaderboardRepository(db), 10);
  const visible = ranked.find((row) => row.profileHandle === "amina_eats");
  const hidden = ranked.find((row) => row.displayName === "Hidden");
  assert.ok(visible);
  assert.equal(contributorProfilePath(visible?.profileHandle), "/u/amina_eats");
  assert.ok(hidden);
  assert.equal(hidden?.profileHandle, null);
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
