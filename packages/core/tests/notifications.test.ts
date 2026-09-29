import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeNotification,
  groupNotifications,
  isStatusDowngrade,
  kindsForFilter,
  parseNotificationFilter,
  shouldNotifyStatusChange,
  unreadBadge,
  type NotificationRow,
} from "../src/notifications";

const row = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "n1",
  kind: "follow",
  createdAt: 1000,
  readAt: null,
  actor: { handle: "zaid_bites", displayName: "Zaid" },
  placeId: null,
  placeName: null,
  visitId: null,
  listId: null,
  listTitle: null,
  recId: null,
  statusChange: null,
  checkOutcome: null,
  ...overrides,
});

const text = (parts: { text: string }[]) => parts.map((part) => part.text).join("");

test("only a change of status alerts savers, and no history counts as unverified", () => {
  assert.equal(shouldNotifyStatusChange("verified", "halal-options"), true);
  assert.equal(shouldNotifyStatusChange("verified", "verified"), false);
  assert.equal(shouldNotifyStatusChange(null, "unverified"), false);
  assert.equal(shouldNotifyStatusChange(null, "community-verified"), true);
  assert.equal(shouldNotifyStatusChange(undefined, "not-halal"), true);
});

test("a downgrade is bad news and an upgrade is not", () => {
  assert.equal(isStatusDowngrade("verified", "halal-options"), true);
  assert.equal(isStatusDowngrade("community-verified", "not-halal"), true);
  assert.equal(isStatusDowngrade("halal-options", "verified"), false);
  assert.equal(isStatusDowngrade("not-halal", "community-verified"), false);
  assert.equal(isStatusDowngrade(null, "self-declared"), false);
});

test("the halal alert names the status, links to the evidence and carries the reason", () => {
  const item = describeNotification(
    row({
      kind: "status-changed",
      actor: null,
      placeId: "p1",
      placeName: "Persian Darbar",
      statusChange: { previous: "verified", next: "halal-options", reason: "A diner reported pork on 26 Sep." },
    }),
  );
  assert.equal(text(item.parts), "Persian Darbar is now “Halal options”");
  assert.equal(item.detail, "It’s on your want-to-try. A diner reported pork on 26 Sep.");
  assert.equal(item.href, "/place/p1#evidence-panel-title");
  assert.equal(item.downgrade, true);
});

test("a rejected check is worded neutrally and does not name a moderator", () => {
  const rejected = describeNotification(
    row({ kind: "check-reviewed", actor: null, placeId: "p1", placeName: "Zaffran Grill", checkOutcome: "rejected" }),
  );
  assert.match(text(rejected.parts), /didn’t make it through review/);
  assert.equal(rejected.actorHandle, null);
  const approved = describeNotification(
    row({ kind: "check-reviewed", actor: null, placeId: "p1", placeName: "Zaffran Grill", checkOutcome: "approved" }),
  );
  assert.match(text(approved.parts), /was approved and now counts/);
});

test("likes on one visit fold into one line, newest first, and other kinds stay separate", () => {
  const items = groupNotifications([
    row({ id: "a", kind: "like", visitId: "v1", placeName: "Zaffran", createdAt: 10, actor: { handle: "a", displayName: "Umar" } }),
    row({ id: "b", kind: "like", visitId: "v1", placeName: "Zaffran", createdAt: 20, readAt: 5, actor: { handle: "b", displayName: "Zaid" } }),
    row({ id: "c", kind: "like", visitId: "v1", placeName: "Zaffran", createdAt: 15, actor: { handle: "c", displayName: null } }),
    row({ id: "d", kind: "like", visitId: "v2", placeName: "Nalli", createdAt: 5 }),
    row({ id: "e", kind: "follow", createdAt: 30 }),
  ]);
  assert.deepEqual(items.map((item) => item.kind), ["follow", "like", "like"]);
  const folded = items[1];
  assert.deepEqual(folded.ids.sort(), ["a", "b", "c"]);
  assert.equal(text(folded.parts), "Zaid and 2 others liked your visit to Zaffran");
  assert.equal(folded.unread, true);
  assert.equal(text(items[2].parts), "Zaid liked your visit to Nalli");
});

test("places added to one list by one person fold together", () => {
  const items = groupNotifications([
    row({ id: "a", kind: "list-places-added", listId: "l1", listTitle: "Eid dinner shortlist", createdAt: 2 }),
    row({ id: "b", kind: "list-places-added", listId: "l1", listTitle: "Eid dinner shortlist", createdAt: 1 }),
    row({ id: "c", kind: "list-places-added", listId: "l2", listTitle: "Other", createdAt: 3 }),
  ]);
  assert.equal(items.length, 2);
  assert.equal(text(items[1].parts), "Zaid added 2 places to Eid dinner shortlist");
  assert.equal(items[1].href, "/list/l1");
});

test("filters map to kinds and unknown filters fall back to all", () => {
  assert.equal(parseNotificationFilter("halal"), "halal");
  assert.equal(parseNotificationFilter("nope"), "all");
  assert.equal(kindsForFilter("all"), null);
  assert.deepEqual(kindsForFilter("halal"), ["status-changed", "check-reviewed"]);
  assert.deepEqual(kindsForFilter("follows"), ["follow", "follow-request", "follow-accepted"]);
});

test("the badge is capped and hidden at zero", () => {
  assert.equal(unreadBadge(0), null);
  assert.equal(unreadBadge(-2), null);
  assert.equal(unreadBadge(7), "7");
  assert.equal(unreadBadge(100), "99+");
});
