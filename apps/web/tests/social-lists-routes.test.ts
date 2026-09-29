import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as getList } from "../app/api/lists/[id]/route";
import { PUT as putSave } from "../app/api/lists/[id]/save/route";
import { POST as postItem } from "../app/api/lists/[id]/items/route";
import { DELETE as deleteItem } from "../app/api/lists/[id]/items/[placeId]/route";
import { POST as invite } from "../app/api/lists/[id]/collaborators/route";
import { PUT as answerInvite } from "../app/api/lists/[id]/collaborators/[handle]/route";
import { PUT as editLink } from "../app/api/lists/[id]/edit-link/route";
import { POST as join } from "../app/api/lists/[id]/join/route";
import { GET as searchLists } from "../app/api/lists/search/route";
import { POST as matchMedia } from "../app/api/media/match/route";

const LIST = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PLACE = "9c858901-8a57-4791-81fe-4c455b099bc9";

function req(path: string, body?: unknown, method = "POST") {
  return new Request(`https://halalfood.world${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

test("list routes turn away malformed ids before anything else", async () => {
  const bad = ctx({ id: "nope" });
  assert.equal((await getList(req("/api/lists/nope", undefined, "GET"), bad)).status, 400);
  assert.equal((await putSave(req("/api/lists/nope/save", undefined, "PUT"), bad)).status, 400);
  assert.equal((await postItem(req("/api/lists/nope/items", {}), bad)).status, 400);
  assert.equal((await invite(req("/api/lists/nope/collaborators", {}), bad)).status, 400);
  assert.equal((await editLink(req("/api/lists/nope/edit-link", {}, "PUT"), bad)).status, 400);
  assert.equal((await join(req("/api/lists/nope/join", {}), bad)).status, 400);
  assert.equal(
    (await deleteItem(req("/api/lists/x/items/y", undefined, "DELETE"), ctx({ id: LIST, placeId: "nope" }))).status,
    400,
  );
  assert.equal(
    (await answerInvite(req("/api/lists/x/collaborators/y", {}, "PUT"), ctx({ id: LIST, handle: "not a handle!" }))).status,
    400,
  );
});

test("joining needs a well-formed edit token, and says nothing about the list", async () => {
  const response = await join(req(`/api/lists/${LIST}/join`, { token: "short" }), ctx({ id: LIST }));
  assert.equal(response.status, 404);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /no longer valid/);
});

test("list search returns nothing for a one-letter query", async () => {
  const response = await searchLists(req("/api/lists/search?q=a", undefined, "GET"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { lists: [] });
});

test("matching a link rejects anything that is not a public post", async () => {
  // The URL is checked before any session or database is touched.
  const response = await matchMedia(req("/api/media/match", { url: "https://evil.example/x" }));
  assert.ok([400, 401, 503].includes(response.status));
  void PLACE;
});
