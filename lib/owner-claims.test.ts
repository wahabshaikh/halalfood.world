import assert from "node:assert/strict";
import { test } from "vitest";
import { OWNER_CLAIM_PERIOD_DAYS, parseOwnerDetails, type DayHours } from "@/lib/core/owner-claim";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { deleteAccount } from "./profiles";
import {
  applyOwnerClaimEvent,
  attachClaimCheckout,
  claimViewSeries,
  discardPendingClaim,
  featuredPlaces,
  fileOwnerCertificate,
  insertRestaurantPhoto,
  listClaimsForAdmin,
  moderateOwnerClaim,
  ownerClaimForViewer,
  publicOwnerPlace,
  recordPlaceView,
  saveOwnerDetails,
  saveOwnerHours,
  saveOwnerMenu,
  startOwnerClaim,
  viewerOwnsOpenClaim,
} from "./owner-claims";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const PERIOD = OWNER_CLAIM_PERIOD_DAYS * DAY;

function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["a", "b", "mod"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id);
  }
  const place = addPlace(sqlite, { city: "london", name: "Seed Grill House" });
  return { sqlite, db, place };
}

const checkout = (placeId: string, email = "owner@grill.example") => ({ placeId, role: "owner" as const, contactEmail: email });

const week = (): DayHours[] =>
  ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({ day, closed: day === 0, open: day === 0 ? null : "12:00", close: day === 0 ? null : "21:00" }));

const paid = (claimId: string | null, paidAt = NOW, extra: Record<string, unknown> = {}) => ({
  type: "payment.succeeded" as const,
  paymentId: `pay-${paidAt}`,
  claimId,
  checkoutId: null,
  membershipId: "mem_1",
  paidAt,
  ...extra,
});

test("checkout holds the restaurant, payment opens editing, and the public label waits", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.value.created, true);
  await attachClaimCheckout(started.value.id, "ch_1", db, NOW);
  assert.equal((sqlite.prepare("SELECT whop_checkout_id FROM owner_claims WHERE id = ?").get(started.value.id) as { whop_checkout_id: string }).whop_checkout_id, "ch_1");

  const again = await startOwnerClaim("a", checkout(place, "desk@grill.example"), db, NOW + 1000);
  assert.equal(again.ok && again.value.id, started.value.id);
  assert.equal(again.ok && again.value.created, false);

  const blocked = await startOwnerClaim("b", checkout(place), db, NOW + 2000);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.status, 409);

  assert.equal(await viewerOwnsOpenClaim(place, "a", db, NOW + 2000), true);
  assert.equal(await viewerOwnsOpenClaim(place, null, db, NOW), false);
  assert.deepEqual(await publicOwnerPlace(place, db, NOW), { badge: false, hours: null, hoursNote: null, menu: [], details: null });

  assert.equal(await applyOwnerClaimEvent(paid(null, NOW + 5000, { checkoutId: "ch_1" }), db, NOW + 5000), "applied");
  const mine = await ownerClaimForViewer(place, "a", db, NOW + 6000);
  assert.equal(mine?.paidLive, true);
  assert.equal(mine?.public, false);
  assert.equal(mine?.contactEmail, "desk@grill.example");
  assert.equal((sqlite.prepare("SELECT status FROM place_status WHERE place_id = ?").get(place) as { status: string }).status, "unchecked");

  const saved = await saveOwnerHours(started.value.id, "a", week(), "Last seating 20:30", db, NOW + 7000);
  assert.equal(saved.ok, true);
  const menu = await saveOwnerMenu(started.value.id, "a", [{ section: "Mains", name: "Haleem", description: null, price: 12.5, currency: "USD" }], db, NOW + 8000);
  assert.equal(menu.ok && menu.value.count, 1);
  assert.equal((await publicOwnerPlace(place, db, NOW + 8000)).badge, false);

  assert.equal((await moderateOwnerClaim(started.value.id, "mod", "approve", "Called the restaurant", db, NOW + 9000)).ok, true);
  const shown = await publicOwnerPlace(place, db, NOW + 9000);
  assert.equal(shown.badge, true);
  assert.equal(shown.hoursNote, "Last seating 20:30");
  assert.equal(shown.menu[0]?.name, "Haleem");
  assert.equal((sqlite.prepare("SELECT status FROM place_status WHERE place_id = ?").get(place) as { status: string }).status, "unchecked");
  const featured = await featuredPlaces("london", db, NOW + 9000);
  assert.equal(featured.length, 1);
  assert.equal(featured[0]?.placeId, place);
  assert.equal((await featuredPlaces("mumbai", db, NOW + 9000)).length, 0);
});

test("a stranger cannot edit, an unpaid claim cannot edit, and a hidden place cannot be claimed", async () => {
  const { db, sqlite, place } = world();
  const hidden = addPlace(sqlite, { status: "hidden" });
  assert.equal((await startOwnerClaim("a", checkout(hidden), db, NOW)).ok, false);
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  assert.equal((await saveOwnerHours(started.value.id, "b", week(), null, db, NOW)).ok, false);
  const unpaid = await saveOwnerMenu(started.value.id, "a", [], db, NOW);
  assert.equal(unpaid.ok, false);
  if (unpaid.ok) return;
  assert.equal(unpaid.status, 403);
  assert.equal(await ownerClaimForViewer(place, "b", db, NOW), null);
  await discardPendingClaim(started.value.id, db);
  assert.equal(await ownerClaimForViewer(place, "a", db, NOW), null);
});

test("the same payment does not extend twice, renewal does, and a refund hides the claim", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  const id = started.value.id;
  assert.equal(await applyOwnerClaimEvent(paid(id), db, NOW), "applied");
  const until = (sqlite.prepare("SELECT active_until FROM owner_claims WHERE id = ?").get(id) as { active_until: number }).active_until;
  assert.equal(until, NOW + PERIOD);
  assert.equal(await applyOwnerClaimEvent(paid(id), db, NOW + 1000), "duplicate");
  assert.equal((sqlite.prepare("SELECT active_until FROM owner_claims WHERE id = ?").get(id) as { active_until: number }).active_until, until);

  assert.equal(await applyOwnerClaimEvent(paid(id, NOW + PERIOD), db, NOW + PERIOD), "applied");
  assert.equal((sqlite.prepare("SELECT active_until FROM owner_claims WHERE id = ?").get(id) as { active_until: number }).active_until, NOW + PERIOD + PERIOD);

  assert.equal(await applyOwnerClaimEvent({ type: "membership.deactivated", membershipId: "mem_1", claimId: null }, db, NOW + PERIOD), "applied");
  assert.equal((sqlite.prepare("SELECT renews FROM owner_claims WHERE id = ?").get(id) as { renews: number }).renews, 0);
  assert.equal(await applyOwnerClaimEvent({ type: "membership.renewing", membershipId: "mem_1", claimId: id }, db, NOW + PERIOD), "applied");
  assert.equal((sqlite.prepare("SELECT renews FROM owner_claims WHERE id = ?").get(id) as { renews: number }).renews, 1);

  assert.equal(await applyOwnerClaimEvent({ type: "refund", paymentId: null, membershipId: "mem_1" }, db, NOW + PERIOD), "applied");
  assert.equal((sqlite.prepare("SELECT status FROM owner_claims WHERE id = ?").get(id) as { status: string }).status, "refunded");
  assert.equal((await publicOwnerPlace(place, db, NOW + PERIOD)).badge, false);
  assert.equal(await applyOwnerClaimEvent(paid(id, NOW + PERIOD + 10), db, NOW), "unmatched");
});

test("a removed claim can be restored, and declining the label does not touch halal status", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  await applyOwnerClaimEvent(paid(started.value.id), db, NOW);
  assert.equal((await moderateOwnerClaim(started.value.id, "mod", "reject", null, db, NOW + 1)).ok, true);
  assert.equal((await publicOwnerPlace(place, db, NOW + 1)).badge, false);
  assert.equal((await moderateOwnerClaim(started.value.id, "mod", "remove", "Not the owner", db, NOW + 2)).ok, true);
  assert.equal((await moderateOwnerClaim(started.value.id, "mod", "restore", null, db, NOW + 3)).ok, true);
  assert.equal((await moderateOwnerClaim(started.value.id, "mod", "approve", null, db, NOW + 4)).ok, true);
  assert.equal((await publicOwnerPlace(place, db, NOW + 4)).badge, true);
  const actions = sqlite.prepare("SELECT action FROM audit_log WHERE target_id = ? ORDER BY rowid").all(started.value.id) as { action: string }[];
  assert.deepEqual(actions.map((row) => row.action), ["reject-owner-claim", "remove-owner-claim", "restore-owner-claim", "approve-owner-claim"]);
  assert.equal((await moderateOwnerClaim("missing", "mod", "approve", null, db, NOW)).ok, false);
  assert.equal((sqlite.prepare("SELECT status FROM place_status WHERE place_id = ?").get(place) as { status: string }).status, "unchecked");
});

test("featured placement is capped and kept to approved claims in that city", async () => {
  const { db, sqlite } = world();
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const place = addPlace(sqlite, { city: "london", name: `Grill ${index}` });
    const started = await startOwnerClaim("a", checkout(place, `owner${index}@grill.example`), db, NOW + index);
    if (!started.ok) throw new Error("claim");
    ids.push(started.value.id);
    await applyOwnerClaimEvent(paid(started.value.id, NOW + 1000 + index, { membershipId: `mem_${index}`, paymentId: `pay_${index}` }), db, NOW + 1000 + index);
    await moderateOwnerClaim(started.value.id, "mod", "approve", null, db, NOW + 2000 + index);
  }
  const shown = await featuredPlaces("london", db, NOW + 10_000);
  assert.equal(shown.length, 4);
  assert.deepEqual(shown.map((item) => item.claimId), ids.slice(0, 4));
  await moderateOwnerClaim(ids[0], "mod", "reject", null, db, NOW + 11_000);
  const after = await featuredPlaces("london", db, NOW + 11_000);
  assert.equal(after.some((item) => item.claimId === ids[0]), false);
  assert.equal(after.some((item) => item.claimId === ids[4]), true);
});

test("a certificate stays pending and a restaurant photo is labelled without changing status", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  await applyOwnerClaimEvent(paid(started.value.id), db, NOW);
  const photo = await insertRestaurantPhoto(started.value.id, "a", { r2Key: "photos/a.jpg", contentType: "image/jpeg", byteSize: 10 }, db, NOW + 1);
  assert.equal(photo.ok, true);
  const filed = await fileOwnerCertificate(
    started.value.id,
    "a",
    { r2Key: "photos/cert.jpg", contentType: "image/jpeg", byteSize: 20 },
    "HMC",
    NOW + 40 * DAY,
    db,
    NOW + 2,
  );
  assert.equal(filed.ok, true);
  const signal = sqlite.prepare("SELECT review_status, certified, source FROM place_signals WHERE place_id = ?").get(place) as {
    review_status: string;
    certified: string;
    source: string;
  };
  assert.equal(signal.review_status, "pending");
  assert.equal(signal.certified, "yes");
  assert.equal(signal.source, "certificate");
  const labels = sqlite.prepare("SELECT listed_by FROM place_photos WHERE place_id = ? ORDER BY created_at").all(place) as { listed_by: string }[];
  assert.deepEqual(labels.map((row) => row.listed_by), ["restaurant", "restaurant"]);
  assert.equal((sqlite.prepare("SELECT status FROM place_status WHERE place_id = ?").get(place) as { status: string }).status, "unchecked");
  assert.equal((await insertRestaurantPhoto(started.value.id, "b", { r2Key: "x", contentType: "image/jpeg", byteSize: 1 }, db, NOW)).ok, false);
});

test("view counts are daily totals with no visitor id, and only the buyer can read them", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  await recordPlaceView(place, db, NOW);
  await recordPlaceView(place, db, NOW + 1000);
  await recordPlaceView("00000000-0000-4000-8000-000000009999", db, NOW);
  const row = sqlite.prepare("SELECT views FROM place_view_days WHERE place_id = ?").get(place) as { views: number };
  assert.equal(row.views, 2);
  const columns = sqlite.prepare("PRAGMA table_info(place_view_days)").all() as { name: string }[];
  assert.deepEqual(columns.map((column) => column.name).sort(), ["day", "place_id", "views"]);
  const series = await claimViewSeries(started.value.id, "a", db, NOW);
  assert.equal(series.ok, true);
  if (!series.ok) return;
  assert.equal(series.value.at(-1)?.views, 2);
  assert.equal(series.value.length, 30);
  assert.equal((await claimViewSeries(started.value.id, "b", db, NOW)).ok, false);
});

test("deleting the buyer keeps the paid claim and clears the contact email", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  await applyOwnerClaimEvent(paid(started.value.id), db, NOW);
  await moderateOwnerClaim(started.value.id, "mod", "approve", null, db, NOW + 1);
  await deleteAccount("a", db, NOW + 2);
  const row = sqlite.prepare("SELECT user_id, contact_email, status FROM owner_claims WHERE id = ?").get(started.value.id) as {
    user_id: string | null;
    contact_email: string;
    status: string;
  };
  assert.equal(row.user_id, null);
  assert.equal(row.contact_email, "");
  assert.equal(row.status, "active");
  assert.equal((await publicOwnerPlace(place, db, NOW + 3)).badge, true);
  const admin = await listClaimsForAdmin(db, NOW + 3);
  assert.equal(admin[0]?.buyer, null);
  assert.equal(admin[0]?.public, true);
});

test("an expired claim can be bought again", async () => {
  const { db, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  await applyOwnerClaimEvent({ ...paid(started.value.id), membershipId: "mem_old" }, db, NOW);
  await applyOwnerClaimEvent({ type: "membership.deactivated", membershipId: "mem_old", claimId: started.value.id }, db, NOW);
  const next = await startOwnerClaim("b", checkout(place, "next@grill.example"), db, NOW + PERIOD + DAY);
  assert.equal(next.ok, true);
});

test("only the verified owner can edit phone, website and description", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  const id = started.value.id;
  const parsed = parseOwnerDetails({
    phone: "<b>+1 (415) 555-0134</b>",
    website: "https://grill.example/menu",
    description: "<script>alert(1)</script> Family kitchen <!-- note --> on Brick Lane",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const unpaid = await saveOwnerDetails(id, "a", { phone: "+14155550134", website: null, description: null }, db, NOW);
  assert.equal(unpaid.ok, false);
  if (unpaid.ok) return;
  assert.equal(unpaid.status, 403);

  assert.equal(await applyOwnerClaimEvent(paid(id), db, NOW + 1), "applied");
  const saved = await saveOwnerDetails(id, "a", parsed.value, db, NOW + 2);
  assert.equal(saved.ok, true);
  const row = sqlite.prepare("SELECT phone, website, description FROM owner_place_details WHERE place_id = ?").get(place) as {
    phone: string;
    website: string;
    description: string;
  };
  assert.equal(row.phone, "+1 (415) 555-0134");
  assert.equal(row.website, "https://grill.example/menu");
  assert.equal(row.description, "alert(1) Family kitchen on Brick Lane");
  assert.equal((await publicOwnerPlace(place, db, NOW + 2)).details, null);
  assert.equal((sqlite.prepare("SELECT telephone, website FROM places WHERE id = ?").get(place) as { telephone: string | null; website: string | null }).telephone, null);
  assert.equal((sqlite.prepare("SELECT status FROM place_status WHERE place_id = ?").get(place) as { status: string }).status, "unchecked");

  const stranger = await saveOwnerDetails(id, "b", { phone: "+14155550111", website: null, description: null }, db, NOW + 3);
  assert.equal(stranger.ok, false);
  if (stranger.ok) return;
  assert.equal(stranger.status, 404);
  const moderator = await saveOwnerDetails(id, "mod", { phone: null, website: null, description: "Nope" }, db, NOW + 3);
  assert.equal(moderator.ok, false);
  if (moderator.ok) return;
  assert.equal(moderator.status, 404);

  assert.equal((await moderateOwnerClaim(id, "mod", "approve", null, db, NOW + 4)).ok, true);
  assert.deepEqual((await publicOwnerPlace(place, db, NOW + 4)).details, {
    phone: "+1 (415) 555-0134",
    website: "https://grill.example/menu",
    description: "alert(1) Family kitchen on Brick Lane",
  });

  const clearedInput = parseOwnerDetails({ phone: "", website: "  ", description: "<b></b>" });
  assert.equal(clearedInput.ok, true);
  if (!clearedInput.ok) return;
  const cleared = await saveOwnerDetails(id, "a", clearedInput.value, db, NOW + 5);
  assert.equal(cleared.ok, true);
  assert.deepEqual((await publicOwnerPlace(place, db, NOW + 5)).details, { phone: null, website: null, description: null });
});

test("a manager, a refunded owner and a removed claim cannot edit contact details", async () => {
  const { db, sqlite, place } = world();
  const managed = await startOwnerClaim("a", { ...checkout(place), role: "manager" }, db, NOW);
  if (!managed.ok) return;
  await applyOwnerClaimEvent(paid(managed.value.id), db, NOW);
  const manager = await saveOwnerDetails(managed.value.id, "a", { phone: "+14155550134", website: null, description: null }, db, NOW + 1);
  assert.equal(manager.ok, false);
  if (manager.ok) return;
  assert.equal(manager.status, 403);
  assert.match(manager.error, /owner/);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM owner_place_details").get() as { n: number }).n, 0);

  const other = addPlace(sqlite, { city: "london", name: "Other Grill" });
  const owned = await startOwnerClaim("a", checkout(other), db, NOW + 2);
  if (!owned.ok) return;
  await applyOwnerClaimEvent(paid(owned.value.id, NOW + 2, { membershipId: "mem_other", paymentId: "pay_other" }), db, NOW + 2);
  assert.equal((await saveOwnerDetails(owned.value.id, "a", { phone: "+442079460958", website: "http://other.example", description: "Open late" }, db, NOW + 3)).ok, true);
  await applyOwnerClaimEvent({ type: "refund", paymentId: "pay_other", membershipId: "mem_other" }, db, NOW + 4);
  const refunded = await saveOwnerDetails(owned.value.id, "a", { phone: "+442079460000", website: null, description: null }, db, NOW + 5);
  assert.equal(refunded.ok, false);
  if (refunded.ok) return;
  assert.equal(refunded.status, 403);
  assert.equal((sqlite.prepare("SELECT phone FROM owner_place_details WHERE place_id = ?").get(other) as { phone: string }).phone, "+442079460958");

  const third = addPlace(sqlite, { city: "london", name: "Third Grill" });
  const removedClaim = await startOwnerClaim("b", checkout(third, "b@grill.example"), db, NOW + 6);
  if (!removedClaim.ok) return;
  await applyOwnerClaimEvent(paid(removedClaim.value.id, NOW + 6, { membershipId: "mem_b", paymentId: "pay_b" }), db, NOW + 6);
  await moderateOwnerClaim(removedClaim.value.id, "mod", "remove", null, db, NOW + 7);
  const removed = await saveOwnerDetails(removedClaim.value.id, "b", { phone: "+14155550199", website: null, description: null }, db, NOW + 8);
  assert.equal(removed.ok, false);
  if (removed.ok) return;
  assert.equal(removed.status, 403);
});

test("broken hours JSON is treated as unset", async () => {
  const { db, sqlite, place } = world();
  const started = await startOwnerClaim("a", checkout(place), db, NOW);
  if (!started.ok) return;
  await applyOwnerClaimEvent(paid(started.value.id), db, NOW);
  await moderateOwnerClaim(started.value.id, "mod", "approve", null, db, NOW);
  sqlite.prepare("INSERT INTO owner_hours (place_id, claim_id, week_json, note, updated_at) VALUES (?, ?, ?, NULL, ?)").run(place, started.value.id, "{", NOW);
  const shown = await publicOwnerPlace(place, db, NOW + 1);
  assert.equal(shown.badge, true);
  assert.equal(shown.hours, null);
});
