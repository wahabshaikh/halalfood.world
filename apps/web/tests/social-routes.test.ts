import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as checkHandle } from "../app/api/handles/check/route";
import { GET as searchPeople } from "../app/api/people/search/route";
import { POST as follow } from "../app/api/follows/[handle]/route";
import { POST as respond } from "../app/api/follow-requests/[handle]/route";
import { isSafeAvatarR2Key, isSafeEvidenceR2Key, isSafePhotoR2Key, isSafeR2Key } from "../src/lib/r2";

const HASH = "a".repeat(64);
const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("the handle check rejects bad and reserved handles before touching the database", async () => {
  for (const handle of ["", "ab", "has space", "admin", "-nope"]) {
    const response = await checkHandle(
      new Request(`https://halalfood.world/api/handles/check?handle=${encodeURIComponent(handle)}`),
    );
    assert.equal(response.status, 200, handle);
    const body = (await response.json()) as { available: boolean; error?: string };
    assert.equal(body.available, false, handle);
    assert.ok(body.error, handle);
  }
});

test("people search returns nothing for a query that is too short", async () => {
  const response = await searchPeople(new Request("https://halalfood.world/api/people/search?q=%40a"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { people: [] });
});

test("following needs a well-formed handle before anything else", async () => {
  const response = await follow(
    new Request("https://halalfood.world/api/follows/x", { method: "POST" }),
    { params: Promise.resolve({ handle: "not a handle!" }) },
  );
  assert.equal(response.status, 400);
});

test("answering a follow request needs an explicit accept or decline", async () => {
  const response = await respond(
    new Request("https://halalfood.world/api/follow-requests/zaid", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ handle: "zaid_bites" }) },
  );
  assert.equal(response.status, 400);
});

test("avatar keys are their own namespace and never reach the evidence proxy", () => {
  const avatar = `avatars/${HASH}/${UUID}.webp`;
  assert.equal(isSafeAvatarR2Key(avatar), true);
  assert.equal(isSafeAvatarR2Key(`avatars/${HASH}/${UUID}.pdf`), false);
  assert.equal(isSafeAvatarR2Key(`avatars/../${UUID}.jpg`), false);
  assert.equal(isSafeAvatarR2Key(`photos/${HASH}/${UUID}.jpg`), false);
  // The shared evidence and photo proxy must not serve avatars, or evidence keys as avatars.
  assert.equal(isSafeR2Key(avatar), false);
  assert.equal(isSafePhotoR2Key(avatar), false);
  assert.equal(isSafeEvidenceR2Key(avatar), false);
  assert.equal(isSafeAvatarR2Key(`community-verification/${HASH}/${UUID}.pdf`), false);
});
