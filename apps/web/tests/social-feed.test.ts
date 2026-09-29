import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@halalfood/core/user-preferences";
import {
  addComment,
  deleteComment,
  getComment,
  getVisitAccess,
  getVisitCard,
  listComments,
  listFriendsFeed,
  setLike,
} from "../src/lib/feed-repository";
import {
  blockUser,
  countFollows,
  findUserIdByHandle,
  followUser,
  getRelation,
  unblockUser,
  unfollowUser,
} from "../src/lib/social-repository";
import { migratedDatabase, sqliteClient } from "./helpers/sqlite-client";

const NOW = Date.now();
const HOUR = 3_600_000;

type World = ReturnType<typeof world>;

/** Users: viewer, friend, stranger, blocked, hermit (private account). */
function world() {
  const db = migratedDatabase();
  const client = sqliteClient(db);
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${(sequence += 1)}`;

  const user = (name: string, extra: { privateVisits?: boolean } = {}) => {
    const userId = `user-${name}`;
    db.prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(userId, name, `${name}@example.com`, NOW, NOW);
    db.prepare(
      `INSERT INTO user_profiles (user_id, handle, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(userId, `${name}-handle`, name.toUpperCase(), NOW, NOW);
    if (extra.privateVisits)
      db.prepare(
        `INSERT INTO user_preferences (user_id, visibility_visits, allergies, cuisines, created_at, updated_at)
         VALUES (?, 'private', '[]', '[]', ?, ?)`,
      ).run(userId, NOW, NOW);
    return userId;
  };

  /** A place; approved certification evidence makes it verified. */
  const place = (name: string, options: { certified?: boolean; alcohol?: boolean } = {}) => {
    const placeId = id("place");
    db.prepare(
      `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
       VALUES (?, ?, 'mumbai', 'https://example.com', '1 Test Road', '[]', 'test', 'https://example.com', ?, ?, 1)`,
    ).run(placeId, name, NOW, NOW);
    if (options.certified) {
      const verificationId = id("verification");
      db.prepare(
        `INSERT INTO place_halal_verifications
          (id, place_id, submitted_by_user_id, status, created_at, updated_at, evidence_kind,
           claimed_status, scope, certification_body, captured_at, expires_at, relationship, incentivized)
         VALUES (?, ?, 'user-viewer', 'approved', ?, ?, 'certification', 'verified', 'venue', 'Test Body', ?, ?, 'none', 0)`,
      ).run(verificationId, placeId, NOW, NOW, NOW - HOUR, NOW + 365 * 24 * HOUR);
    }
    if (options.alcohol)
      db.prepare(
        `INSERT INTO place_facts (place_id, serves_alcohol, service_types, meals, updated_at)
         VALUES (?, 'yes', '[]', '[]', ?)`,
      ).run(placeId, NOW);
    return placeId;
  };

  const visit = (
    userId: string,
    placeId: string,
    options: {
      at?: number;
      visibility?: "public" | "private";
      share?: boolean;
      verdict?: string;
      note?: string;
      halal?: { status: string; certificate?: string; alcohol?: string; meat?: string };
    } = {},
  ) => {
    const visitId = crypto.randomUUID();
    const at = options.at ?? NOW - HOUR;
    db.prepare(
      `INSERT INTO place_visits (id, user_id, place_id, visited_at, context, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?, ?)`,
    ).run(visitId, userId, placeId, at, options.visibility ?? "public", at, at);
    let verificationId: string | null = null;
    if (options.halal) {
      verificationId = id("halal-check");
      db.prepare(
        `INSERT INTO place_halal_verifications (id, place_id, submitted_by_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(verificationId, placeId, userId, options.halal.status, at, at);
      db.prepare(
        `INSERT INTO place_halal_check_answers (verification_id, certificate, alcohol, meat, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        verificationId,
        options.halal.certificate ?? null,
        options.halal.alcohol ?? null,
        options.halal.meat ?? null,
        at,
      );
    }
    db.prepare(
      `INSERT INTO place_check_ins (visit_id, place_id, user_id, would_return, value_verdict, note, verdict, halal_verification_id, created_at, updated_at)
       VALUES (?, ?, ?, 'definitely', 'fair', ?, ?, ?, ?, ?)`,
    ).run(visitId, placeId, userId, options.note ?? null, options.verdict ?? "liked", verificationId, at, at);
    db.prepare(
      `INSERT INTO place_check_in_dishes (id, visit_id, place_id, dish_name, normalized_name, verdict, created_at)
       VALUES (?, ?, ?, 'Nihari', 'nihari', 'order-again', ?)`,
    ).run(id("dish"), visitId, placeId, at);
    if (options.share !== false)
      db.prepare(
        `INSERT INTO feed_events (id, actor_id, kind, visit_id, place_id, created_at) VALUES (?, ?, 'visit', ?, ?, ?)`,
      ).run(id("event"), userId, visitId, placeId, at);
    return visitId;
  };

  return {
    db,
    client,
    user,
    place,
    visit,
    users: {
      viewer: user("viewer"),
      friend: user("friend"),
      stranger: user("stranger"),
      blocked: user("blocked"),
      hermit: user("hermit", { privateVisits: true }),
    },
  };
}

async function follow(w: World, from: keyof World["users"], to: keyof World["users"]) {
  const result = await followUser(w.users[from], w.users[to], w.client);
  assert.equal(result.ok, true);
}

const prefs = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  ...DEFAULT_PREFERENCES,
  minimumStatus: "unverified",
  ...overrides,
});

async function feed(w: World, overrides: Partial<UserPreferences> = {}, cursor?: string, limit?: number) {
  return listFriendsFeed(
    { viewerId: w.users.viewer, preferences: prefs(overrides), cursor, limit },
    w.client,
  );
}

test("the feed shows followed and own visits, not strangers, newest first", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  const mine = w.visit(w.users.viewer, place, { at: NOW - 3 * HOUR });
  const friends = w.visit(w.users.friend, place, { at: NOW - 2 * HOUR, note: "Soft nihari", verdict: "favourite" });
  w.visit(w.users.stranger, place, { at: NOW - HOUR });
  await follow(w, "viewer", "friend");

  const page = await feed(w);
  assert.deepEqual(page.cards.map((card) => card.visitId), [friends, mine]);
  const [card] = page.cards;
  assert.equal(card.author.handle, "friend-handle");
  assert.equal(card.author.isYou, false);
  assert.equal(page.cards[1].author.isYou, true);
  assert.equal(card.verdict, "favourite");
  assert.equal(card.note, "Soft nihari");
  assert.deepEqual(card.dishes, [{ name: "Nihari", verdict: "order-again" }]);
  assert.equal(card.place.status, "verified");
  assert.equal(page.nextCursor, null);
});

test("private visits, unshared visits and private accounts never reach the feed", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  w.visit(w.users.friend, place, { visibility: "private" });
  w.visit(w.users.friend, place, { share: false });
  w.visit(w.users.hermit, place);
  await follow(w, "viewer", "friend");
  await follow(w, "viewer", "hermit");
  assert.equal((await feed(w)).cards.length, 0);
});

test("blocking hides a friend in both directions and removes the follow", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  const visit = w.visit(w.users.friend, place);
  await follow(w, "viewer", "friend");
  assert.equal((await feed(w)).cards.length, 1);

  await blockUser(w.users.viewer, w.users.friend, w.client);
  assert.equal((await feed(w)).cards.length, 0);
  assert.equal((await getRelation(w.users.viewer, w.users.friend, w.client)).following, false);
  assert.equal(await getVisitCard(visit, w.users.viewer, w.client), null);

  // The blocked side is hidden from the blocker too, and cannot follow back.
  assert.equal(await getVisitCard(w.visit(w.users.viewer, place), w.users.friend, w.client), null);
  assert.deepEqual(await followUser(w.users.friend, w.users.viewer, w.client), {
    ok: false,
    reason: "blocked",
  });

  await unblockUser(w.users.viewer, w.users.friend, w.client);
  await follow(w, "viewer", "friend");
  // The friend's visit is back, next to the viewer's own one made above.
  assert.equal((await feed(w)).cards.length, 2);
});

test("a place that fails the viewer's own standard is left out and counted", async () => {
  const w = world();
  const certified = w.place("Certified", { certified: true });
  const unknown = w.place("No evidence");
  const alcohol = w.place("Bar and grill", { certified: true, alcohol: true });
  w.visit(w.users.friend, certified, { at: NOW - 3 * HOUR });
  w.visit(w.users.friend, unknown, { at: NOW - 2 * HOUR });
  w.visit(w.users.friend, alcohol, { at: NOW - HOUR });
  await follow(w, "viewer", "friend");

  const open = await feed(w);
  assert.equal(open.cards.length, 3);
  assert.equal(open.hiddenByStandard, 0);

  const strict = await feed(w, { minimumStatus: "verified", avoidAlcohol: true });
  assert.deepEqual(strict.cards.map((card) => card.place.name), ["Certified"]);
  assert.equal(strict.hiddenByStandard, 2);
});

test("your own visit is never hidden by your own standard", async () => {
  const w = world();
  const unknown = w.place("No evidence");
  w.visit(w.users.viewer, unknown);
  const page = await feed(w, { minimumStatus: "verified" });
  assert.equal(page.cards.length, 1);
  assert.equal(page.hiddenByStandard, 0);
});

test("a friend's halal check shows as their observation, and rejected ones vanish", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  w.visit(w.users.friend, place, {
    at: NOW - 3 * HOUR,
    halal: { status: "pending", certificate: "seen", alcohol: "none" },
  });
  w.visit(w.users.friend, place, {
    at: NOW - 2 * HOUR,
    halal: { status: "rejected", certificate: "seen" },
  });
  w.visit(w.users.friend, place, { at: NOW - HOUR });
  await follow(w, "viewer", "friend");

  const cards = (await feed(w)).cards;
  assert.equal(cards.length, 3);
  const [none, rejected, pending] = cards;
  assert.equal(none.halalCheck, null);
  assert.equal(rejected.halalCheck, null);
  assert.deepEqual(pending.halalCheck, {
    status: "pending",
    certificate: "seen",
    alcohol: "none",
    meat: null,
  });
  // The place's own status still comes only from approved evidence.
  assert.equal(pending.place.status, "verified");
});

test("the feed pages with a cursor and fills a page across filtered rows", async () => {
  const w = world();
  const good = w.place("Certified", { certified: true });
  const bad = w.place("No evidence");
  await follow(w, "viewer", "friend");
  const wanted: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    w.visit(w.users.friend, bad, { at: NOW - (10 + index) * HOUR });
    wanted.push(w.visit(w.users.friend, good, { at: NOW - (20 + index) * HOUR - 1 }));
  }
  const strict = { minimumStatus: "verified" } as const;

  const first = await feed(w, strict, undefined, 2);
  assert.equal(first.cards.length, 2);
  assert.ok(first.nextCursor);
  const second = await feed(w, strict, first.nextCursor!, 2);
  const third = await feed(w, strict, second.nextCursor!, 2);
  const seen = [...first.cards, ...second.cards, ...third.cards].map((card) => card.visitId);
  assert.equal(new Set(seen).size, 5);
  assert.deepEqual(new Set(seen), new Set(wanted));
  assert.equal(third.nextCursor, null);
});

test("likes are idempotent and counted; comments respect blocks and ownership", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  const visit = w.visit(w.users.friend, place);
  await follow(w, "viewer", "friend");

  assert.equal(await setLike(visit, w.users.viewer, true, w.client), 1);
  assert.equal(await setLike(visit, w.users.viewer, true, w.client), 1);
  assert.equal(await setLike(visit, w.users.stranger, true, w.client), 2);
  const liked = await getVisitCard(visit, w.users.viewer, w.client);
  assert.equal(liked?.likes, 2);
  assert.equal(liked?.liked, true);
  assert.equal((await getVisitCard(visit, w.users.stranger, w.client))?.liked, true);
  assert.equal(await setLike(visit, w.users.viewer, false, w.client), 1);

  const comment = await addComment(visit, w.users.viewer, "Going Sunday <b>inshallah</b>", w.users.friend, w.client);
  assert.equal(comment.author.handle, "viewer-handle");
  assert.equal(comment.body, "Going Sunday <b>inshallah</b>");
  await addComment(visit, w.users.stranger, "Nice", w.users.friend, w.client);
  assert.equal((await getVisitCard(visit, w.users.viewer, w.client))?.comments, 2);

  // The owner and the author can delete; the view says so.
  const asOwner = await listComments(visit, w.users.friend, w.users.friend, w.client);
  assert.deepEqual(asOwner.map((entry) => entry.canDelete), [true, true]);
  const asViewer = await listComments(visit, w.users.viewer, w.users.friend, w.client);
  assert.deepEqual(asViewer.map((entry) => entry.canDelete), [true, false]);
  const asAnonymous = await listComments(visit, null, w.users.friend, w.client);
  assert.deepEqual(asAnonymous.map((entry) => entry.canDelete), [false, false]);

  // A blocked commenter disappears for the person who blocked them.
  await blockUser(w.users.friend, w.users.stranger, w.client);
  const afterBlock = await listComments(visit, w.users.friend, w.users.friend, w.client);
  assert.deepEqual(afterBlock.map((entry) => entry.author.handle), ["viewer-handle"]);

  assert.deepEqual(await getComment(comment.id, w.client), {
    id: comment.id,
    visitId: visit,
    authorId: w.users.viewer,
  });
  await deleteComment(comment.id, w.client);
  assert.equal(await getComment(comment.id, w.client), null);
});

test("hidden comments are neither listed nor counted", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  const visit = w.visit(w.users.friend, place);
  const comment = await addComment(visit, w.users.viewer, "rude", w.users.friend, w.client);
  w.db.prepare(`UPDATE comments SET status = 'hidden' WHERE id = ?`).run(comment.id);
  assert.equal((await listComments(visit, w.users.friend, w.users.friend, w.client)).length, 0);
  assert.equal((await getVisitCard(visit, w.users.friend, w.client))?.comments, 0);
  assert.equal(await getComment(comment.id, w.client), null);
});

test("visit access follows visibility, privacy and blocks", async () => {
  const w = world();
  const place = w.place("Nalli", { certified: true });
  const publicVisit = w.visit(w.users.friend, place);
  const privateVisit = w.visit(w.users.friend, place, { visibility: "private" });
  const hermitVisit = w.visit(w.users.hermit, place);

  assert.equal((await getVisitCard(publicVisit, null, w.client))?.visitId, publicVisit);
  assert.equal(await getVisitCard(privateVisit, w.users.viewer, w.client), null);
  assert.equal((await getVisitCard(privateVisit, w.users.friend, w.client))?.visitId, privateVisit);
  assert.equal(await getVisitCard(hermitVisit, w.users.viewer, w.client), null);
  assert.equal(await getVisitCard(crypto.randomUUID(), w.users.viewer, w.client), null);
  const access = await getVisitAccess(publicVisit, w.users.viewer, w.client);
  assert.equal(access?.ownerId, w.users.friend);
});

test("follows are one-way, unique and cannot target yourself", async () => {
  const w = world();
  await follow(w, "viewer", "friend");
  await follow(w, "viewer", "friend");
  assert.deepEqual(await followUser(w.users.viewer, w.users.viewer, w.client), {
    ok: false,
    reason: "self",
  });
  assert.deepEqual(await countFollows(w.users.friend, w.client), { followers: 1, following: 0 });
  assert.deepEqual(await countFollows(w.users.viewer, w.client), { followers: 0, following: 1 });
  const relation = await getRelation(w.users.friend, w.users.viewer, w.client);
  assert.equal(relation.following, false);
  assert.equal(relation.followedBy, true);
  await unfollowUser(w.users.viewer, w.users.friend, w.client);
  assert.deepEqual(await countFollows(w.users.friend, w.client), { followers: 0, following: 0 });
  assert.equal(await findUserIdByHandle("friend-handle", w.client), w.users.friend);
  assert.equal(await findUserIdByHandle("nobody", w.client), null);
});

test("an upheld report hides a comment, a dismissed one leaves it", async () => {
  const { createReport, resolveReport } = await import("../src/lib/moderation-repository");
  const { commentReportTarget } = await import("@halalfood/core/feed");
  const w = world();
  const place = w.place("Nalli", { certified: true });
  const visit = w.visit(w.users.friend, place);
  const keep = await addComment(visit, w.users.stranger, "fine", w.users.friend, w.client);
  const remove = await addComment(visit, w.users.stranger, "abusive", w.users.friend, w.client);
  w.db.prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES (?, 'moderator', ?)`).run(
    w.users.hermit,
    NOW,
  );

  const keepReport = await createReport(
    { targetType: "check-in", targetId: commentReportTarget(keep.id), reason: "harassment", detail: "x" },
    w.users.viewer,
    w.client,
  );
  const removeReport = await createReport(
    { targetType: "check-in", targetId: commentReportTarget(remove.id), reason: "harassment", detail: "x" },
    w.users.viewer,
    w.client,
  );
  assert.equal(await resolveReport(keepReport, w.users.hermit, "dismissed", null, w.client), true);
  assert.equal(await resolveReport(removeReport, w.users.hermit, "upheld", "abusive", w.client), true);

  const visible = await listComments(visit, w.users.friend, w.users.friend, w.client);
  assert.deepEqual(visible.map((entry) => entry.id), [keep.id]);

  // Reporting the visit itself, or upholding it, never touches comments.
  const visitReport = await createReport(
    { targetType: "check-in", targetId: visit, reason: "fraud", detail: null },
    w.users.viewer,
    w.client,
  );
  assert.equal(await resolveReport(visitReport, w.users.hermit, "upheld", null, w.client), true);
  assert.equal((await listComments(visit, w.users.friend, w.users.friend, w.client)).length, 1);
});
