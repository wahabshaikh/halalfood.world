import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REC_NOTE_LENGTH,
  MAX_REC_RECIPIENTS,
  canSendRec,
  cleanRecNote,
  recShareUrl,
  validateRec,
  validateRecReply,
  whatsappShareUrl,
} from "../src/recs";

const PLACE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const LIST = "9c858901-8a57-4791-81fe-4c455b099bc9";

test("a rec is exactly one of a place or a list, for one or more friends", () => {
  const ok = validateRec({ placeId: PLACE, recipients: ["@Zaid_Bites", "hafsa_k", "zaid_bites"], note: "  Friday   after Jumuah?  " });
  assert.deepEqual(ok, {
    ok: true,
    rec: { target: { kind: "place", id: PLACE }, recipients: ["zaid_bites", "hafsa_k"], note: "Friday after Jumuah?" },
  });
  assert.equal(validateRec({ listId: LIST, recipients: ["zaid_bites"] }).ok, true);
  assert.equal(validateRec({ placeId: PLACE, listId: LIST, recipients: ["zaid_bites"] }).ok, false);
  assert.equal(validateRec({ recipients: ["zaid_bites"] }).ok, false);
  assert.equal(validateRec({ placeId: "not-an-id", recipients: ["zaid_bites"] }).ok, false);
  assert.equal(validateRec(null).ok, false);
});

test("recipients are handles, at least one and at most ten", () => {
  assert.equal(validateRec({ placeId: PLACE, recipients: [] }).ok, false);
  assert.equal(validateRec({ placeId: PLACE, recipients: ["no spaces"] }).ok, false);
  assert.equal(validateRec({ placeId: PLACE, recipients: [42] }).ok, false);
  const many = Array.from({ length: MAX_REC_RECIPIENTS + 1 }, (_, i) => `friend_${i}`);
  assert.equal(validateRec({ placeId: PLACE, recipients: many }).ok, false);
  assert.equal(validateRec({ placeId: PLACE, recipients: many.slice(0, MAX_REC_RECIPIENTS) }).ok, true);
});

test("the note is one short line of plain text", () => {
  assert.deepEqual(cleanRecNote(undefined), { ok: true, note: null });
  assert.deepEqual(cleanRecNote("   "), { ok: true, note: null });
  assert.equal(cleanRecNote("a".repeat(MAX_REC_NOTE_LENGTH + 1)).ok, false);
  assert.equal(cleanRecNote("a".repeat(MAX_REC_NOTE_LENGTH)).ok, true);
  assert.equal(cleanRecNote(5).ok, false);
  assert.deepEqual(cleanRecNote("one\n\ntwo"), { ok: true, note: "one two" });
});

test("the only replies are the two fixed answers", () => {
  assert.deepEqual(validateRecReply({ reply: "in" }), { ok: true, reply: "in" });
  assert.deepEqual(validateRecReply({ reply: "want-to-try" }), { ok: true, reply: "want-to-try" });
  assert.equal(validateRecReply({ reply: "sounds great, let's go on Friday" }).ok, false);
  assert.equal(validateRecReply(null).ok, false);
});

test("you can send to someone you follow or who follows you, never yourself or across a block", () => {
  const base = {
    senderId: "a",
    recipientId: "b",
    senderFollowsRecipient: false,
    recipientFollowsSender: false,
    blockedEitherWay: false,
  };
  assert.equal(canSendRec(base), false);
  assert.equal(canSendRec({ ...base, senderFollowsRecipient: true }), true);
  assert.equal(canSendRec({ ...base, recipientFollowsSender: true }), true);
  assert.equal(canSendRec({ ...base, senderFollowsRecipient: true, blockedEitherWay: true }), false);
  assert.equal(canSendRec({ ...base, recipientId: "a", senderFollowsRecipient: true }), false);
});

test("share links open the public place or list page", () => {
  assert.equal(recShareUrl({ kind: "place", id: PLACE }), `https://halalfood.world/place/${PLACE}`);
  assert.equal(recShareUrl({ kind: "list", id: LIST }, "http://localhost:3000"), `http://localhost:3000/list/${LIST}`);
  assert.equal(
    whatsappShareUrl("Zaffran Grill?", "https://halalfood.world/place/x"),
    "https://wa.me/?text=Zaffran%20Grill%3F%20https%3A%2F%2Fhalalfood.world%2Fplace%2Fx",
  );
});
