import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@halalfood/core/user-preferences";
import { validateRec } from "@halalfood/core/recs";
import { validateEvent } from "@halalfood/core/events";
import { weekStart } from "@halalfood/core/leaderboard";
import {
  listNotifications,
  markNotificationsRead,
  notify,
  notifyFriendVisit,
  notifyStatusChange,
  unreadNotificationCount,
} from "../src/lib/notifications-repository";
import { listRecipients, listRecs, markRecsRead, replyToRec, sendRecs, unreadRecCount } from "../src/lib/recs-repository";
import {
  createEvent,
  getEvent,
  getGoing,
  listUpcomingEvents,
  setEventCancelled,
  setRsvp,
  updateEvent,
} from "../src/lib/events-repository";
import { getViewerStanding, listRankedDiners } from "../src/lib/diner-leaderboard";
import { blockUser, followUser, respondToFollowRequest } from "../src/lib/social-repository";
import { updateProfile } from "../src/lib/preferences-repository";
import { recordStatusChange } from "../src/lib/place-decision";
import { reviewEvidence } from "../src/lib/moderation-repository";
import { setLike } from "../src/lib/feed-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const P1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const P2 = "9c858901-8a57-4791-81fe-4c455b099bc9";
const NOW = Date.UTC(2026, 8, 30, 12); // Wednesday
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** ayesha, zaid and mariam are public diners, hafsa is private, umar is a stranger. */
async function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["ayesha", "zaid", "mariam", "hafsa", "umar"]) addUser(sqlite, id);
  await updateProfile("ayesha", { handle: "ayesha_eats", displayName: "Ayesha Khan" }, db);
  await updateProfile("zaid", { handle: "zaid_bites", displayName: "Zaid" }, db);
  await updateProfile("mariam", { handle: "mariam_m", displayName: "Mariam" }, db);
  await updateProfile("hafsa", { handle: "hafsa_k", displayName: "Hafsa K", isPrivate: true }, db);
  await updateProfile("umar", { handle: "umar_bites", displayName: "Umar" }, db);
  sqlite.exec(`UPDATE user_profiles SET onboarded_at = 1`);
  for (const [id, name, city] of [
    [P1, "Zaffran Grill", "mumbai"],
    [P2, "Persian Darbar", "london"],
  ])
    sqlite
      .prepare(
        `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
         VALUES (?, ?, ?, 'u', 'a', '[]', 's', 'u', 1, 1, 1)`,
      )
      .run(id, name, city);
  return { sqlite, db };
}

type World = Awaited<ReturnType<typeof world>>;

function visit(
  w: World,
  userId: string,
  placeId: string,
  options: { at?: number; method?: string; confidence?: string; incentivized?: boolean; share?: boolean } = {},
) {
  const id = crypto.randomUUID();
  const at = options.at ?? NOW - HOUR;
  w.sqlite
    .prepare(
      `INSERT INTO place_visits (id, user_id, place_id, visited_at, verification_method, verification_confidence, context, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', 'public', ?, ?)`,
    )
    .run(id, userId, placeId, at, options.method ?? "location", options.confidence ?? "high", at, at);
  w.sqlite
    .prepare(
      `INSERT INTO place_check_ins (visit_id, place_id, user_id, would_return, value_verdict, verdict, incentivized, created_at, updated_at)
       VALUES (?, ?, ?, 'definitely', 'fair', 'liked', ?, ?, ?)`,
    )
    .run(id, placeId, userId, options.incentivized ? 1 : 0, at, at);
  if (options.share !== false)
    w.sqlite
      .prepare(`INSERT INTO feed_events (id, actor_id, kind, visit_id, place_id, created_at) VALUES (?, ?, 'visit', ?, ?, ?)`)
      .run(crypto.randomUUID(), userId, id, placeId, at);
  return id;
}

function save(w: World, userId: string, placeId: string) {
  w.sqlite
    .prepare(`INSERT INTO saved_places (user_id, place_id, created_at) VALUES (?, ?, 1)`)
    .run(userId, placeId);
}

const prefs = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  ...DEFAULT_PREFERENCES,
  minimumStatus: "unverified",
  ...overrides,
});

/* --------------------------------------------------------- notifications -- */

test("a notification is written once per dedupe key, never to yourself, and never across a block", async () => {
  const { db } = await world();
  const base = { userId: "ayesha", kind: "follow" as const, actorId: "zaid", dedupeKey: "follow:zaid" };
  await notify(base, db);
  await notify(base, db);
  await notify({ ...base, userId: "zaid", dedupeKey: "self" }, db);
  assert.equal(await unreadNotificationCount("ayesha", db), 1);
  assert.equal(await unreadNotificationCount("zaid", db), 0);

  await blockUser("mariam", "ayesha", db);
  await notify({ ...base, actorId: "mariam", dedupeKey: "follow:mariam" }, db);
  assert.equal(await unreadNotificationCount("ayesha", db), 1);
});

test("following, requesting and accepting notify once, and following again stays quiet", async () => {
  const { db } = await world();
  await followUser("ayesha", "zaid_bites", db);
  await followUser("ayesha", "hafsa_k", db);
  assert.deepEqual(
    (await listNotifications("zaid", "all", db)).map((item) => item.kind),
    ["follow"],
  );
  assert.deepEqual(
    (await listNotifications("hafsa", "follows", db)).map((item) => item.kind),
    ["follow-request"],
  );

  await respondToFollowRequest("hafsa", "ayesha_eats", true, db);
  const [accepted] = await listNotifications("ayesha", "follows", db);
  assert.equal(accepted.kind, "follow-accepted");
  assert.equal(accepted.actorHandle, "hafsa_k");

  // Unfollow and follow again: no second ping for Zaid.
  await db.run(
    (await import("drizzle-orm")).sql`DELETE FROM follows WHERE follower_id = 'ayesha' AND followee_id = 'zaid'`,
  );
  await followUser("ayesha", "zaid_bites", db);
  assert.equal((await listNotifications("zaid", "all", db)).length, 1);
});

test("likes on one visit fold into one line and count each person once", async () => {
  const w = await world();
  const visitId = visit(w, "ayesha", P1);
  for (const [actor, handle] of [
    ["zaid", "zaid_bites"],
    ["mariam", "mariam_m"],
    ["umar", "umar_bites"],
  ] as const) {
    await setLike(visitId, actor, true, w.db);
    await notify(
      { userId: "ayesha", kind: "like", actorId: actor, visitId, placeId: P1, dedupeKey: `like:${visitId}:${actor}` },
      w.db,
    );
    void handle;
  }
  // A repeat like from the same person adds nothing.
  await notify(
    { userId: "ayesha", kind: "like", actorId: "zaid", visitId, placeId: P1, dedupeKey: `like:${visitId}:zaid` },
    w.db,
  );

  const items = await listNotifications("ayesha", "all", w.db);
  assert.equal(items.length, 1);
  assert.equal(items[0].ids.length, 3);
  assert.equal(items[0].href, `/visit/${visitId}`);
  const line = items[0].parts.map((part) => part.text).join("");
  assert.match(line, /and 2 others liked your visit to Zaffran Grill/);
});

test("reading notifications marks them seen, and the badge counts only unread", async () => {
  const { db } = await world();
  await notify({ userId: "ayesha", kind: "follow", actorId: "zaid", dedupeKey: "a" }, db);
  await notify({ userId: "ayesha", kind: "follow", actorId: "mariam", dedupeKey: "b" }, db);
  assert.equal(await unreadNotificationCount("ayesha", db), 2);
  const [first] = await listNotifications("ayesha", "all", db);
  await markNotificationsRead("ayesha", first.ids, db);
  assert.equal(await unreadNotificationCount("ayesha", db), 1);
  // Someone else's ids do nothing.
  await markNotificationsRead("zaid", "all", db);
  assert.equal(await unreadNotificationCount("ayesha", db), 1);
  await markNotificationsRead("ayesha", "all", db);
  assert.equal(await unreadNotificationCount("ayesha", db), 0);
});

test("a status change tells everyone who saved the place, with the evidence reason", async () => {
  const w = await world();
  save(w, "ayesha", P2);
  save(w, "zaid", P2);
  save(w, "mariam", P1);

  await recordStatusChange(
    P2,
    { status: "halal-options", confidence: "medium", reasons: ["A diner reported pork on the menu on 26 Sep."] } as never,
    { verificationId: null },
    w.db,
  );
  const [alert] = await listNotifications("ayesha", "halal", w.db);
  assert.equal(alert.kind, "status-changed");
  assert.equal(alert.href, `/place/${P2}#evidence-panel-title`);
  assert.equal(alert.parts.map((part) => part.text).join(""), "Persian Darbar is now “Halal options”");
  assert.match(alert.detail ?? "", /pork on the menu/);
  assert.equal((await listNotifications("zaid", "halal", w.db)).length, 1);
  // Someone who saved a different place hears nothing.
  assert.equal((await listNotifications("mariam", "halal", w.db)).length, 0);

  // The same status again is not a change, and a confidence-only move says nothing.
  assert.equal(
    await recordStatusChange(P2, { status: "halal-options", confidence: "medium", reasons: [] } as never, {}, w.db),
    false,
  );
  await recordStatusChange(P2, { status: "halal-options", confidence: "high", reasons: [] } as never, {}, w.db);
  assert.equal((await listNotifications("ayesha", "halal", w.db)).length, 1);
});

test("a place with no history is unverified, so its first real status still tells savers", async () => {
  const w = await world();
  save(w, "ayesha", P1);
  await notifyStatusChange(P1, "no-history", null, "unverified", w.db);
  assert.equal((await listNotifications("ayesha", "all", w.db)).length, 0);
});

test("a friend's shared visit tells followers who saved the place, and nobody else", async () => {
  const w = await world();
  save(w, "ayesha", P1);
  save(w, "umar", P1);
  await followUser("ayesha", "zaid_bites", w.db);
  const shared = visit(w, "zaid", P1);
  await notifyFriendVisit({ visitId: shared, actorId: "zaid", placeId: P1 }, w.db);

  const [item] = await listNotifications("ayesha", "all", w.db);
  const kinds = (await listNotifications("ayesha", "all", w.db)).map((entry) => entry.kind);
  assert.deepEqual(kinds, ["friend-visit"]);
  assert.match(item.parts.map((part) => part.text).join(""), /Zaid visited Zaffran Grill, which is on your want-to-try/);
  // Umar saved it but does not follow Zaid.
  assert.equal((await listNotifications("umar", "all", w.db)).length, 0);

  // An unshared visit never notifies.
  const hidden = visit(w, "zaid", P1, { share: false, at: NOW - 2 * HOUR });
  await notifyFriendVisit({ visitId: hidden, actorId: "zaid", placeId: P1 }, w.db);
  assert.equal((await listNotifications("ayesha", "all", w.db)).length, 1);
});

test("reviewing a halal check closes the loop with whoever filed it", async () => {
  const w = await world();
  w.sqlite.exec(`INSERT INTO moderators (user_id, role, created_at) VALUES ('mariam', 'moderator', 1)`);
  const id = "verification-1";
  w.sqlite
    .prepare(
      `INSERT INTO place_halal_verifications (id, place_id, submitted_by_user_id, status, created_at, updated_at)
       VALUES (?, ?, 'ayesha', 'pending', 1, 1)`,
    )
    .run(id, P1);
  const result = await reviewEvidence(id, "mariam", "approved", null, w.db);
  assert.equal(result.ok, true);
  const [item] = await listNotifications("ayesha", "halal", w.db);
  assert.equal(item.kind, "check-reviewed");
  assert.match(item.parts.map((part) => part.text).join(""), /was approved and now counts/);
  assert.equal(item.actorHandle, null);
});

test("blocking clears notifications and recs between the two", async () => {
  const w = await world();
  await followUser("ayesha", "zaid_bites", w.db);
  await followUser("zaid", "ayesha_eats", w.db);
  const sent = validateRec({ placeId: P1, recipients: ["zaid_bites"], note: "Try the seekh" });
  assert.equal(sent.ok, true);
  if (sent.ok) await sendRecs("ayesha", sent.rec, w.db);
  assert.equal((await listNotifications("zaid", "all", w.db)).length, 2);

  await blockUser("zaid", "ayesha", w.db);
  assert.equal((await listNotifications("zaid", "all", w.db)).length, 0);
  assert.equal((await listRecs("zaid", "inbox", prefs(), w.db)).cards.length, 0);
});

/* ------------------------------------------------------------------ recs -- */

function rec(input: Record<string, unknown>) {
  const result = validateRec(input);
  if (!result.ok) throw new Error(result.error);
  return result.rec;
}

test("recs go to people you follow or who follow you, once, and never to strangers", async () => {
  const w = await world();
  await followUser("ayesha", "zaid_bites", w.db);
  await followUser("mariam", "ayesha_eats", w.db);

  const result = await sendRecs(
    "ayesha",
    rec({ placeId: P1, recipients: ["zaid_bites", "mariam_m", "umar_bites", "nobody_here"], note: "  Friday after Jumuah?  " }),
    w.db,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.outcomes, [
    { handle: "zaid_bites", status: "sent" },
    { handle: "mariam_m", status: "sent" },
    { handle: "umar_bites", status: "not-a-friend" },
    { handle: "nobody_here", status: "not-a-friend" },
  ]);

  const again = await sendRecs("ayesha", rec({ placeId: P1, recipients: ["zaid_bites"] }), w.db);
  assert.deepEqual(again.ok && again.outcomes, [{ handle: "zaid_bites", status: "already-sent" }]);

  const inbox = await listRecs("zaid", "inbox", prefs(), w.db);
  assert.equal(inbox.cards.length, 1);
  assert.equal(inbox.cards[0].note, "Friday after Jumuah?");
  assert.equal(inbox.cards[0].person.handle, "ayesha_eats");
  assert.equal(inbox.cards[0].target.kind, "place");
  assert.equal((await listRecs("ayesha", "sent", prefs(), w.db)).cards.length, 2);
  assert.deepEqual(
    (await listRecipients("ayesha", w.db)).map((person) => person.handle),
    ["mariam_m", "zaid_bites"],
  );
});

test("the inbox hides places that fail the reader's standard and says how many", async () => {
  const w = await world();
  await followUser("ayesha", "zaid_bites", w.db);
  await sendRecs("ayesha", rec({ placeId: P1, recipients: ["zaid_bites"] }), w.db);
  // Nothing is verified here, so a strict standard rules the place out.
  const strict = await listRecs("zaid", "inbox", prefs({ minimumStatus: "verified" }), w.db);
  assert.equal(strict.cards.length, 0);
  assert.equal(strict.hiddenByStandard, 1);
  // The sender still sees what they sent.
  assert.equal((await listRecs("ayesha", "sent", prefs({ minimumStatus: "verified" }), w.db)).cards.length, 1);
});

test("a list can be sent, a private one cannot, and only public lists pass through", async () => {
  const w = await world();
  await followUser("ayesha", "zaid_bites", w.db);
  const insert = (id: string, owner: string, visibility: string) =>
    w.sqlite
      .prepare(
        `INSERT INTO place_lists (id, user_id, title, slug, ranked, visibility, created_at, updated_at) VALUES (?, ?, 'Biryani, ranked', ?, 0, ?, 1, 1)`,
      )
      .run(id, owner, id, visibility);
  insert("3f2504e0-4f89-11d3-9a0c-0305e82c3311", "ayesha", "public");
  insert("3f2504e0-4f89-11d3-9a0c-0305e82c3312", "ayesha", "private");
  insert("3f2504e0-4f89-11d3-9a0c-0305e82c3313", "mariam", "unlisted");

  const ok = await sendRecs("ayesha", rec({ listId: "3f2504e0-4f89-11d3-9a0c-0305e82c3311", recipients: ["zaid_bites"] }), w.db);
  assert.equal(ok.ok, true);
  const privateList = await sendRecs("ayesha", rec({ listId: "3f2504e0-4f89-11d3-9a0c-0305e82c3312", recipients: ["zaid_bites"] }), w.db);
  assert.deepEqual(privateList, { ok: false, reason: "list-not-shareable" });
  const unlistedElsewhere = await sendRecs("ayesha", rec({ listId: "3f2504e0-4f89-11d3-9a0c-0305e82c3313", recipients: ["zaid_bites"] }), w.db);
  assert.deepEqual(unlistedElsewhere, { ok: false, reason: "list-not-shareable" });
  const missing = await sendRecs("ayesha", rec({ placeId: "3f2504e0-4f89-11d3-9a0c-0305e82c3399", recipients: ["zaid_bites"] }), w.db);
  assert.deepEqual(missing, { ok: false, reason: "target-not-found" });

  const [card] = (await listRecs("zaid", "inbox", prefs(), w.db)).cards;
  assert.equal(card.target.kind, "list");
});

test("replying is one of two fixed answers, and want to try saves the place", async () => {
  const w = await world();
  await followUser("ayesha", "zaid_bites", w.db);
  await sendRecs("ayesha", rec({ placeId: P1, recipients: ["zaid_bites"] }), w.db);
  assert.equal(await unreadRecCount("zaid", w.db), 1);
  const [card] = (await listRecs("zaid", "inbox", prefs(), w.db)).cards;
  assert.equal(card.unread, true);

  // Someone who was not sent it cannot answer.
  assert.deepEqual(await replyToRec(card.id, "umar", "in", w.db), { ok: false, reason: "not-found" });
  assert.deepEqual(await replyToRec(card.id, "zaid", "want-to-try", w.db), { ok: true, reply: "want-to-try" });
  assert.equal(
    w.sqlite.prepare(`SELECT COUNT(*) AS n FROM saved_places WHERE user_id = 'zaid' AND place_id = ?`).get(P1)!.n,
    1,
  );
  const [reply] = await listNotifications("ayesha", "all", w.db);
  assert.equal(reply.kind, "rec-reply");
  assert.equal((await listRecs("ayesha", "sent", prefs(), w.db)).cards[0].reply, "want-to-try");

  await markRecsRead("zaid", w.db);
  assert.equal(await unreadRecCount("zaid", w.db), 0);
});

/* ---------------------------------------------------------------- events -- */

function eventInput(overrides: Record<string, unknown> = {}) {
  const result = validateEvent({
    title: "Minara Masjid iftar walk",
    citySlug: "mumbai",
    venue: "Mohammed Ali Rd",
    startsAt: NOW + 2 * DAY,
    vendors: [
      { name: "Malpua Lane", note: "Malpua, phirni", placeId: P1 },
      { name: "Stall 14", note: "Seekh" },
    ],
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.event;
}

test("an event carries a status per vendor and never calls an unlisted stall not halal", async () => {
  const w = await world();
  w.sqlite
    .prepare(
      `INSERT INTO place_halal_verifications
        (id, place_id, submitted_by_user_id, status, created_at, updated_at, evidence_kind,
         claimed_status, scope, certification_body, captured_at, expires_at, relationship, incentivized)
       VALUES ('v1', ?, 'ayesha', 'approved', ?, ?, 'certification', 'verified', 'venue', 'Test Body', ?, ?, 'none', 0)`,
    )
    .run(P1, NOW, NOW, NOW - HOUR, NOW + 365 * DAY);

  const created = await createEvent(eventInput(), "mariam", w.db);
  assert.equal(created.ok, true);
  const event = (await getEvent(created.ok ? created.id : "", w.db, NOW))!;
  assert.equal(event.phase, "upcoming");
  assert.equal(event.vendorCount, 2);
  const [listed, unlisted] = event.vendors;
  assert.equal(listed.status.label, "Verified halal");
  assert.equal(listed.status.listed, true);
  assert.equal(unlisted.status.label, "Unverified");
  assert.equal(unlisted.status.listed, false);
  assert.doesNotMatch(unlisted.status.note, /not halal/i);
});

test("a vendor can only link a listed place", async () => {
  const w = await world();
  const result = await createEvent(
    eventInput({ vendors: [{ name: "Ghost", placeId: "3f2504e0-4f89-11d3-9a0c-0305e82c3399" }] }),
    "mariam",
    w.db,
  );
  assert.deepEqual(result, { ok: false, reason: "unknown-place" });
});

test("upcoming events are soonest first, per city, and leave out finished and cancelled ones", async () => {
  const w = await world();
  const make = async (title: string, startsAt: number, citySlug = "mumbai", endsAt?: number) => {
    const created = await createEvent(eventInput({ title, startsAt, citySlug, endsAt, vendors: [] }), "mariam", w.db);
    return created.ok ? created.id : "";
  };
  const later = await make("Later", NOW + 5 * DAY);
  await make("Sooner", NOW + DAY);
  await make("Finished", NOW - 3 * DAY, "mumbai", NOW - 2 * DAY);
  const cancelled = await make("Cancelled", NOW + 2 * DAY);
  await make("London fest", NOW + DAY, "london");
  await setEventCancelled(cancelled, true, w.db);

  assert.deepEqual(
    (await listUpcomingEvents({ citySlug: "mumbai", now: NOW }, w.db)).map((event) => event.title),
    ["Sooner", "Later"],
  );
  assert.equal((await listUpcomingEvents({ now: NOW }, w.db)).length, 3);
  assert.equal((await getEvent(cancelled, w.db, NOW))!.cancelled, true);

  const updated = await updateEvent(later, eventInput({ title: "Moved", startsAt: NOW + 6 * DAY, vendors: [] }), w.db);
  assert.equal(updated.ok, true);
  assert.equal((await getEvent(later, w.db, NOW))!.title, "Moved");
});

test("RSVPs count everyone, name only friends, and close once the event is over", async () => {
  const w = await world();
  const created = await createEvent(eventInput({ vendors: [] }), "mariam", w.db);
  const id = created.ok ? created.id : "";
  await followUser("ayesha", "zaid_bites", w.db);
  await blockUser("ayesha", "umar", w.db);
  await setRsvp(id, "zaid", true, w.db, NOW);
  await setRsvp(id, "umar", true, w.db, NOW);
  await setRsvp(id, "zaid", true, w.db, NOW);

  const seen = await getGoing(id, "ayesha", w.db);
  assert.equal(seen.going, 2);
  assert.deepEqual(seen.friends.map((friend) => friend.handle), ["zaid_bites"]);
  assert.equal(seen.line, "Zaid and 1 other going");
  assert.equal(seen.viewerGoing, false);
  assert.equal((await getGoing(id, null, w.db)).friends.length, 0);

  const mine = await setRsvp(id, "ayesha", true, w.db, NOW);
  assert.equal(mine.ok && mine.state.viewerGoing, true);
  const gone = await setRsvp(id, "ayesha", false, w.db, NOW);
  assert.equal(gone.ok && gone.state.going, 2);

  assert.deepEqual(await setRsvp(id, "mariam", true, w.db, NOW + 10 * DAY), { ok: false, reason: "closed" });
  assert.deepEqual(await setRsvp("missing", "mariam", true, w.db, NOW), { ok: false, reason: "not-found" });
});

/* ----------------------------------------------------------- leaderboard -- */

test("the week starts on Monday at midnight UTC", () => {
  assert.equal(weekStart(NOW), Date.UTC(2026, 8, 28));
  assert.equal(weekStart(Date.UTC(2026, 8, 28, 0, 0, 0)), Date.UTC(2026, 8, 28));
  assert.equal(weekStart(Date.UTC(2026, 8, 27, 23, 59)), Date.UTC(2026, 8, 21));
});

test("the board counts verified visits once per place per day and ignores anything rewarded", async () => {
  const w = await world();
  // Zaid: two days at Zaffran plus one at Persian Darbar this week, and a repeat the same day.
  visit(w, "zaid", P1, { at: NOW - HOUR });
  visit(w, "zaid", P1, { at: NOW - 2 * HOUR });
  visit(w, "zaid", P1, { at: NOW - 2 * DAY });
  visit(w, "zaid", P2, { at: NOW - DAY });
  // Mariam: two unverified and one rewarded visit do not count, one real one does.
  visit(w, "mariam", P1, { method: "none", confidence: "none" });
  visit(w, "mariam", P2, { incentivized: true });
  visit(w, "mariam", P2, { at: NOW - 5 * HOUR });
  // Umar: one verified visit last week, so all time only.
  visit(w, "umar", P1, { at: NOW - 9 * DAY });
  // Hafsa is a private account and is never listed.
  visit(w, "hafsa", P1);

  const week = await listRankedDiners("week", null, NOW, w.db);
  assert.deepEqual(
    week.map((row) => [row.rank, row.handle, row.verified, row.places]),
    [
      [1, "zaid_bites", 3, 2],
      [2, "mariam_m", 1, 1],
    ],
  );
  const all = await listRankedDiners("all", null, NOW, w.db);
  assert.deepEqual(all.map((row) => row.handle), ["zaid_bites", "mariam_m", "umar_bites"]);
  const london = await listRankedDiners("all", "london", NOW, w.db);
  assert.deepEqual(london.map((row) => [row.handle, row.verified]), [["mariam_m", 1], ["zaid_bites", 1]]);
});

test("opting out removes a diner from the board and pins their own standing to them", async () => {
  const w = await world();
  visit(w, "zaid", P1, { at: NOW - HOUR });
  visit(w, "zaid", P2, { at: NOW - HOUR });
  visit(w, "mariam", P1, { at: NOW - HOUR });
  visit(w, "umar", P2, { at: NOW - DAY });

  const mine = await getViewerStanding("mariam", "week", null, NOW, w.db);
  assert.equal(mine?.listed, true);
  assert.equal(mine?.standing.rank, 2);
  assert.equal(mine?.standing.toPass, 2);
  assert.equal(mine?.standing.nextAhead?.handle, "zaid_bites");

  await updateProfile("mariam", { showOnLeaderboards: false }, w.db);
  const hidden = await getViewerStanding("mariam", "week", null, NOW + 1000, w.db);
  assert.equal(hidden?.hiddenReason, "opted-out");
  assert.equal(hidden?.listed, false);
  assert.equal(hidden?.standing.verified, 1);
  assert.deepEqual(
    (await listRankedDiners("week", null, NOW + 2000, w.db)).map((row) => row.handle),
    ["zaid_bites", "umar_bites"],
  );

  const priv = await getViewerStanding("hafsa", "week", null, NOW, w.db);
  assert.equal(priv?.hiddenReason, "private-account");
});
