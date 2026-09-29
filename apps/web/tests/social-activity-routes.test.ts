import { test } from "node:test";
import assert from "node:assert/strict";
import { POST as markRead } from "../app/api/notifications/read/route";
import { POST as sendRec } from "../app/api/recs/route";
import { POST as replyToRec } from "../app/api/recs/[id]/reply/route";
import { PUT as goingPut, GET as goingGet } from "../app/api/events/[id]/going/route";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("marking read needs all or a list of ids before anything else", async () => {
  for (const body of [{}, { ids: [] }, { ids: [1] }, { all: "yes" }, "not json"]) {
    const response = await markRead(post("https://halalfood.world/api/notifications/read", body));
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("sending a rec needs exactly one target, friends and a short note", async () => {
  const url = "https://halalfood.world/api/recs";
  const cases: unknown[] = [
    {},
    { placeId: UUID },
    { placeId: UUID, recipients: [] },
    { placeId: UUID, listId: UUID, recipients: ["zaid_bites"] },
    { placeId: "nope", recipients: ["zaid_bites"] },
    { placeId: UUID, recipients: ["zaid_bites"], note: "x".repeat(141) },
    "not json",
  ];
  for (const body of cases) {
    const response = await sendRec(post(url, body));
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("a reply is one of the two fixed answers", async () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const url = `https://halalfood.world/api/recs/${UUID}/reply`;
  assert.equal((await replyToRec(post(url, { reply: "in" }), context("bad-id"))).status, 400);
  assert.equal((await replyToRec(post(url, { reply: "see you there!" }), context(UUID))).status, 400);
  assert.equal((await replyToRec(post(url, {}), context(UUID))).status, 400);
});

test("event RSVPs reject a malformed event id", async () => {
  const context = { params: Promise.resolve({ id: "nope" }) };
  const url = "https://halalfood.world/api/events/nope/going";
  assert.equal((await goingPut(new Request(url, { method: "PUT" }), context)).status, 400);
  assert.equal((await goingGet(new Request(url), context)).status, 400);
});
