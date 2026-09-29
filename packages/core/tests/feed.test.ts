import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMMENT_LENGTH,
  canComment,
  canDeleteComment,
  canViewVisit,
  commentReportTarget,
  decodeFeedCursor,
  encodeFeedCursor,
  parseCommentReportTarget,
  validateComment,
  type VisitAudience,
} from "../src/feed";
import {
  VERDICTS,
  validateCheckIn,
  wouldReturnForVerdict,
} from "../src/check-in";
import { validateReport } from "../src/moderation";

const audience = (overrides: Partial<VisitAudience> = {}): VisitAudience => ({
  viewerId: "viewer",
  ownerId: "owner",
  visitVisibility: "public",
  ownerVisitsVisibility: "public",
  blocked: false,
  ...overrides,
});

test("comments are trimmed, bounded and plain text", () => {
  assert.deepEqual(validateComment({ body: "  Going Sunday!  " }), {
    ok: true,
    body: "Going Sunday!",
  });
  assert.equal(validateComment({ body: "   " }).ok, false);
  assert.equal(validateComment({}).ok, false);
  assert.equal(validateComment(null).ok, false);
  assert.equal(validateComment({ body: "a".repeat(MAX_COMMENT_LENGTH + 1) }).ok, false);
  assert.equal(validateComment({ body: "a".repeat(MAX_COMMENT_LENGTH) }).ok, true);
  assert.equal(validateComment({ body: "bad\u0000byte" }).ok, false);
  const collapsed = validateComment({ body: "one\n\n\n\n\ntwo" });
  assert.equal(collapsed.ok && collapsed.body, "one\n\ntwo");
});

test("a public visit is visible, a private one or a private account is not", () => {
  assert.equal(canViewVisit(audience()), true);
  assert.equal(canViewVisit(audience({ viewerId: null })), true);
  assert.equal(canViewVisit(audience({ visitVisibility: "private" })), false);
  assert.equal(canViewVisit(audience({ ownerVisitsVisibility: "private" })), false);
});

test("the owner always sees their own visit, even blocked or private", () => {
  assert.equal(
    canViewVisit(
      audience({
        viewerId: "owner",
        visitVisibility: "private",
        ownerVisitsVisibility: "private",
        blocked: true,
      }),
    ),
    true,
  );
});

test("blocking hides the visit in both directions", () => {
  assert.equal(canViewVisit(audience({ blocked: true })), false);
  assert.equal(canComment(audience({ blocked: true })), false);
});

test("commenting needs a signed-in viewer who can see the visit", () => {
  assert.equal(canComment(audience()), true);
  assert.equal(canComment(audience({ viewerId: null })), false);
  assert.equal(canComment(audience({ visitVisibility: "private" })), false);
});

test("only the author or the visit owner can delete a comment", () => {
  const base = { commentAuthorId: "author", visitOwnerId: "owner" };
  assert.equal(canDeleteComment({ ...base, viewerId: "author" }), true);
  assert.equal(canDeleteComment({ ...base, viewerId: "owner" }), true);
  assert.equal(canDeleteComment({ ...base, viewerId: "someone" }), false);
  assert.equal(canDeleteComment({ ...base, viewerId: null }), false);
});

test("feed cursors round-trip and reject junk", () => {
  const cursor = { createdAt: 1_790_000_000_000, id: "abc-123" };
  assert.deepEqual(decodeFeedCursor(encodeFeedCursor(cursor)), cursor);
  for (const bad of [undefined, "", "nope", "12.", ".abc", "12.a b", "12.a;drop"])
    assert.equal(decodeFeedCursor(bad), null, String(bad));
});

test("a verdict stands in for the return answer and maps onto return intent", () => {
  assert.equal(wouldReturnForVerdict("disliked"), "no");
  assert.equal(wouldReturnForVerdict("okay"), "maybe");
  assert.equal(wouldReturnForVerdict("liked"), "definitely");
  assert.equal(wouldReturnForVerdict("favourite"), "definitely");
  for (const verdict of VERDICTS) {
    const result = validateCheckIn({ verdict, valueVerdict: "fair" });
    assert.equal(result.ok, true, verdict);
    if (!result.ok) continue;
    assert.equal(result.data.verdict, verdict);
    assert.equal(result.data.valueVerdict, "fair");
    assert.equal(result.data.shareToFeed, true);
  }
  assert.equal(validateCheckIn({ verdict: "meh" }).ok, false);
  assert.equal(validateCheckIn({}).ok, false);
  assert.equal(validateCheckIn({ verdict: "liked" }).ok, false, "value is still required");
});

test("an explicit return answer wins over the verdict mapping", () => {
  const result = validateCheckIn({ verdict: "liked", wouldReturn: "maybe", valueVerdict: "fair" });
  assert.equal(result.ok && result.data.wouldReturn, "maybe");
});

test("a private visit is never shared to the feed", () => {
  const result = validateCheckIn({ verdict: "liked", valueVerdict: "fair", visibility: "private" });
  assert.equal(result.ok && result.data.shareToFeed, false);
  const optedOut = validateCheckIn({ verdict: "liked", valueVerdict: "fair", shareToFeed: false });
  assert.equal(optedOut.ok && optedOut.data.shareToFeed, false);
  assert.equal(validateCheckIn({ verdict: "liked", valueVerdict: "fair", shareToFeed: "no" }).ok, false);
});

test("visits and comments can both be reported through the existing targets", () => {
  const visitId = crypto.randomUUID();
  for (const targetId of [visitId, commentReportTarget(crypto.randomUUID())])
    assert.equal(
      validateReport({
        targetType: "check-in",
        targetId,
        reason: "harassment",
        detail: "rude",
      }).ok,
      true,
      targetId,
    );
  const commentId = crypto.randomUUID();
  assert.equal(parseCommentReportTarget(commentReportTarget(commentId)), commentId);
  assert.equal(parseCommentReportTarget(visitId), null);
  assert.equal(parseCommentReportTarget("comment:"), null);
});

test("a halal check reads as the diner's observation and skips not-sure answers", async () => {
  const { describeHalalCheck, relativeTime } = await import("../src/feed");
  assert.deepEqual(
    describeHalalCheck({ certificate: "seen", alcohol: "none", meat: "unsure" }),
    ["Saw a halal certificate", "No alcohol served"],
  );
  assert.deepEqual(
    describeHalalCheck({ certificate: "unsure", alcohol: "served", meat: "machine" }),
    ["Alcohol served", "Staff said machine-slaughtered"],
  );
  assert.deepEqual(describeHalalCheck({ certificate: null, alcohol: null, meat: "hand" }), [
    "Staff said hand-slaughtered (zabiha)",
  ]);
  assert.deepEqual(describeHalalCheck({ certificate: "unsure", alcohol: "unsure", meat: "unsure" }), []);

  const now = Date.parse("2026-09-30T12:00:00Z");
  assert.equal(relativeTime(now - 5_000, now), "now");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5m");
  assert.equal(relativeTime(now - 20 * 3_600_000, now), "20h");
  assert.equal(relativeTime(now - 3 * 86_400_000, now), "3d");
  assert.equal(relativeTime(now - 21 * 86_400_000, now), "3w");
  assert.equal(relativeTime(now - 90 * 86_400_000, now), "2026-07-02");
  assert.equal(relativeTime(now + 1000, now), "now");
});
