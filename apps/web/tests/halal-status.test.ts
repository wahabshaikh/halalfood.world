import { test } from "node:test";
import assert from "node:assert/strict";
import {
  d1HalalStatusRepository,
  getHalalStatus,
  mapHalalStatus,
  type HalalStatusRepository,
} from "../src/lib/halal-status";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("maps zero approved rows to an unverified status", () => {
  assert.deepEqual(
    mapHalalStatus({ approvedCount: 0, latestReviewedAt: null }),
    {
      status: "unverified",
      approvedCount: 0,
      latestReviewedAt: null,
    },
  );
});

test("fails closed for missing or malformed approved counts", () => {
  const invalidCounts: unknown[] = [
    undefined,
    null,
    "",
    "   ",
    " 2 ",
    "not a number",
    -1,
    "-1",
    1.5,
    "1.5",
    Infinity,
    "Infinity",
    NaN,
    "NaN",
    Number.MAX_SAFE_INTEGER + 1,
    String(Number.MAX_SAFE_INTEGER + 1),
  ];

  for (const approvedCount of invalidCounts) {
    assert.deepEqual(
      mapHalalStatus({
        approvedCount,
        latestReviewedAt: "2026-09-17T12:34:56.000Z",
      }),
      { status: "unavailable" },
      `approvedCount=${String(approvedCount)}`,
    );
  }
});

test("maps approved rows to an evidence-backed status with a normalized numeric timestamp", () => {
  const latestReviewedAt = Date.UTC(2026, 8, 17, 12, 34, 56);
  assert.deepEqual(
    mapHalalStatus({ approvedCount: 2, latestReviewedAt }),
    {
      status: "evidence-backed",
      approvedCount: 2,
      latestReviewedAt: new Date(latestReviewedAt).toISOString(),
    },
  );
});

test("normalizes string and Date moderation timestamps", () => {
  const stringTimestamp = mapHalalStatus({
    approvedCount: "3",
    latestReviewedAt: "2026-09-17T12:34:56-04:00",
  });
  const dateTimestamp = mapHalalStatus({
    approvedCount: 1,
    latestReviewedAt: new Date("2026-09-16T08:00:00.000Z"),
  });
  assert.equal(stringTimestamp.status, "evidence-backed");
  assert.equal(dateTimestamp.status, "evidence-backed");
  if (
    stringTimestamp.status !== "evidence-backed" ||
    dateTimestamp.status !== "evidence-backed"
  )
    return;
  assert.equal(stringTimestamp.latestReviewedAt, "2026-09-17T16:34:56.000Z");
  assert.equal(dateTimestamp.latestReviewedAt, "2026-09-16T08:00:00.000Z");
});

test("fails closed when an approved row has a malformed moderation timestamp", () => {
  assert.deepEqual(
    mapHalalStatus({ approvedCount: 1, latestReviewedAt: "not a date" }),
    { status: "unavailable" },
  );
});

test("fails closed when approved rows have no moderation timestamp", () => {
  assert.deepEqual(
    mapHalalStatus({ approvedCount: 1, latestReviewedAt: null }),
    { status: "unavailable" },
  );
});

test("fails closed when an unverified aggregate has an inconsistent timestamp", () => {
  for (const latestReviewedAt of [undefined, "not a date", Date.now()]) {
    assert.deepEqual(
      mapHalalStatus({ approvedCount: 0, latestReviewedAt }),
      { status: "unavailable" },
      `latestReviewedAt=${String(latestReviewedAt)}`,
    );
  }
});

test("requests one place from the injected repository and returns its normalized status", async () => {
  const requestedPlaceIds: string[] = [];
  const repository: HalalStatusRepository = {
    async get(placeId) {
      requestedPlaceIds.push(placeId);
      return {
        approvedCount: "2",
        latestReviewedAt: new Date("2026-09-17T12:34:56.000Z"),
      };
    },
  };

  const result = await getHalalStatus(repository, PLACE_ID);

  assert.deepEqual(requestedPlaceIds, [PLACE_ID]);
  assert.deepEqual(result, {
    status: "evidence-backed",
    approvedCount: 2,
    latestReviewedAt: "2026-09-17T12:34:56.000Z",
  });
});

test("fails closed when the status repository is unavailable", async () => {
  const repository: HalalStatusRepository = {
    async get() {
      throw new Error("D1 unavailable");
    },
  };

  assert.deepEqual(await getHalalStatus(repository, PLACE_ID), {
    status: "unavailable",
  });
});

test("fails closed when the status repository has no published place aggregate", async () => {
  const repository: HalalStatusRepository = {
    async get() {
      return null;
    },
  };

  assert.deepEqual(await getHalalStatus(repository, PLACE_ID), {
    status: "unavailable",
  });
});

test("D1 status repository requires a complete aggregate row for the requested place", async () => {
  const validRow = {
    place_id: PLACE_ID,
    approved_count: 2,
    latest_reviewed_at: "2026-09-17T12:34:56.000Z",
  };
  const incompleteRows = [
    {},
    { ...validRow, place_id: "another-place" },
    { place_id: PLACE_ID, latest_reviewed_at: validRow.latest_reviewed_at },
    { place_id: PLACE_ID, approved_count: validRow.approved_count },
    { ...validRow, approved_count: 0, latest_reviewed_at: "not a date" },
  ];

  const validRepository = d1HalalStatusRepository({
    async all() {
      return [validRow];
    },
  } as never);
  assert.deepEqual(await validRepository.get(PLACE_ID), {
    approvedCount: 2,
    latestReviewedAt: "2026-09-17T12:34:56.000Z",
  });

  for (const row of incompleteRows) {
    const repository = d1HalalStatusRepository({
      async all() {
        return [row];
      },
    } as never);
    assert.equal(
      await repository.get(PLACE_ID),
      null,
      `row=${JSON.stringify(row)}`,
    );
  }
});
