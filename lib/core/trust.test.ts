import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BADGES,
  BAND_LABEL,
  PORK_CAP,
  TIERS,
  dampClusters,
  formatBadges,
  isBurst,
  memberTrust,
  parseBadges,
  parseBand,
  parseTier,
  placeAddNeedsReview,
  placeBadges,
  placeTrust,
  trustBand,
  vouchWeight,
  type BadgeProof,
  type MemberRecord,
  type PlaceProof,
} from "./trust";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const member = (over: Partial<MemberRecord> = {}): MemberRecord => ({
  createdAt: NOW - 2 * DAY,
  emailVerified: true,
  suspended: false,
  moderator: false,
  creator: false,
  accepted: 0,
  acceptedPlaces: 0,
  rejected: 0,
  rejected30d: 0,
  upheldReports90d: 0,
  ...over,
});

const trusted = { createdAt: NOW - 30 * DAY, accepted: 15, acceptedPlaces: 5, rejected: 1 };

test("each tier has its weight", () => {
  assert.deepEqual(memberTrust(member(), NOW), { tier: "new", weight: 0.5 });
  assert.deepEqual(memberTrust(member({ createdAt: NOW - 7 * DAY, accepted: 3, acceptedPlaces: 2 }), NOW), {
    tier: "member",
    weight: 1,
  });
  assert.deepEqual(memberTrust(member(trusted), NOW), { tier: "trusted", weight: 1.5 });
  assert.deepEqual(memberTrust(member({ moderator: true, createdAt: NOW }), NOW), { tier: "moderator", weight: 2 });
});

test("young, suspended, often-rejected and unverified accounts are restricted and count 0", () => {
  const restricted = { tier: "restricted", weight: 0 };
  assert.deepEqual(memberTrust(member({ createdAt: NOW - DAY + 1 }), NOW), restricted);
  assert.deepEqual(memberTrust(member({ createdAt: NOW - DAY }), NOW).tier, "new");
  assert.deepEqual(memberTrust(member({ ...trusted, suspended: true }), NOW), restricted);
  assert.deepEqual(memberTrust(member({ moderator: true, suspended: true }), NOW), restricted);
  assert.deepEqual(memberTrust(member({ ...trusted, rejected: 3, rejected30d: 3 }), NOW), restricted);
  assert.deepEqual(memberTrust(member({ rejected30d: 2 }), NOW).tier, "new");
  assert.deepEqual(memberTrust(member({ emailVerified: false }), NOW), restricted);
});

test("Member needs 7 days, 3 accepted and 2 places", () => {
  const ready = { createdAt: NOW - 7 * DAY, accepted: 3, acceptedPlaces: 2 };
  assert.equal(memberTrust(member({ ...ready, createdAt: NOW - 7 * DAY + 1 }), NOW).tier, "new");
  assert.equal(memberTrust(member({ ...ready, accepted: 2 }), NOW).tier, "new");
  assert.equal(memberTrust(member({ ...ready, acceptedPlaces: 1 }), NOW).tier, "new");
});

test("Trusted needs 30 days, 15 accepted, 90% accepted and no upheld reports", () => {
  assert.equal(memberTrust(member({ ...trusted, createdAt: NOW - 30 * DAY + 1 }), NOW).tier, "member");
  assert.equal(memberTrust(member({ ...trusted, accepted: 14 }), NOW).tier, "member");
  assert.equal(memberTrust(member({ ...trusted, accepted: 18, rejected: 2 }), NOW).tier, "trusted");
  assert.equal(memberTrust(member({ ...trusted, accepted: 17, rejected: 2 }), NOW).tier, "member");
  assert.equal(memberTrust(member({ ...trusted, upheldReports90d: 1 }), NOW).tier, "member");
});

test("a claimed creator is at least Member, but restriction still applies", () => {
  assert.equal(memberTrust(member({ creator: true }), NOW).tier, "member");
  assert.equal(memberTrust(member({ ...trusted, creator: true }), NOW).tier, "trusted");
  assert.equal(memberTrust(member({ creator: true, createdAt: NOW }), NOW).tier, "restricted");
});

test("tiers and bands parse only known names", () => {
  assert.equal(parseTier("trusted"), "trusted");
  assert.equal(parseTier("admin"), null);
  assert.equal(parseBand("some_proof"), "some_proof");
  assert.equal(parseBand(15), null);
});

test("vouch modifiers: owner conflict counts 0, invite ring halves for 30 days", () => {
  const plain = { accountAgeMs: 5 * DAY, placeAddedByInviter: false, verifiedOwner: false };
  assert.equal(vouchWeight(1.5, plain), 1.5);
  assert.equal(vouchWeight(1.5, { ...plain, verifiedOwner: true }), 0);
  assert.equal(vouchWeight(1, { ...plain, placeAddedByInviter: true }), 0.5);
  assert.equal(vouchWeight(1, { ...plain, placeAddedByInviter: true, accountAgeMs: 30 * DAY }), 1);
  assert.equal(vouchWeight(-1, plain), 0);
});

test("3+ vouches from one network within 24 h: only the heaviest counts and the cluster is flagged", () => {
  const at = NOW - 10 * DAY;
  const vouches = [
    { userId: "a", weight: 0.5, ipHash: "net1", at },
    { userId: "b", weight: 1.5, ipHash: "net1", at: at + HOUR },
    { userId: "c", weight: 1, ipHash: "net1", at: at + 23 * HOUR },
    { userId: "d", weight: 1, ipHash: "net2", at },
    { userId: "e", weight: 1, ipHash: null, at },
    { userId: "f", weight: 1, ipHash: null, at },
    { userId: "g", weight: 1, ipHash: null, at },
  ];
  const { vouches: damped, clusters } = dampClusters(vouches);
  assert.deepEqual(
    damped.map((vouch) => vouch.weight),
    [0, 1.5, 0, 1, 1, 1, 1],
  );
  assert.deepEqual(clusters, [["a", "b", "c"]]);
});

test("same-network vouches spread over more than 24 h are not a cluster", () => {
  const vouches = [
    { userId: "a", weight: 1, ipHash: "net", at: NOW },
    { userId: "b", weight: 1, ipHash: "net", at: NOW + 12 * HOUR },
    { userId: "c", weight: 1, ipHash: "net", at: NOW + DAY },
  ];
  const { vouches: damped, clusters } = dampClusters(vouches);
  assert.deepEqual(damped, vouches);
  assert.deepEqual(clusters, []);
});

test("a burst is the last three counted vouches all from New accounts within an hour", () => {
  const vouch = (tier: "new" | "member", minutes: number) => ({ tier, at: NOW + minutes * 60_000 });
  assert.equal(isBurst([vouch("new", 0), vouch("new", 30), vouch("new", 60)]), true);
  assert.equal(isBurst([vouch("new", 0), vouch("new", 30), vouch("new", 61)]), false);
  assert.equal(isBurst([vouch("new", 0), vouch("member", 30), vouch("new", 60)]), false);
  assert.equal(isBurst([vouch("member", -600), vouch("new", 0), vouch("new", 30), vouch("new", 60)]), true);
  assert.equal(isBurst([vouch("new", 0), vouch("new", 30)]), false);
});

const place = (over: Partial<PlaceProof> = {}): PlaceProof => ({
  certificate: false,
  registryMatch: false,
  creators: 0,
  communityWeight: 0,
  settledFacts: 0,
  menu: false,
  openReports: 0,
  disputed: false,
  burst: false,
  porkOnMenu: false,
  ...over,
});

test("a place with no proof scores 0 and is Unverified", () => {
  assert.deepEqual(placeTrust(place()), { score: 0, band: "unverified", review: false });
});

test("proof is 40 for a certificate or a registry match, not both", () => {
  assert.equal(placeTrust(place({ certificate: true })).score, 40);
  assert.equal(placeTrust(place({ registryMatch: true })).score, 40);
  assert.equal(placeTrust(place({ certificate: true, registryMatch: true })).score, 40);
});

test("creators: 15 for the first, 5 per extra, at most 25", () => {
  assert.equal(placeTrust(place({ creators: 1 })).score, 15);
  assert.equal(placeTrust(place({ creators: 2 })).score, 20);
  assert.equal(placeTrust(place({ creators: 3 })).score, 25);
  assert.equal(placeTrust(place({ creators: 9 })).score, 25);
});

test("community grows with log2 of the counted weight, at most 40", () => {
  assert.equal(placeTrust(place({ communityWeight: 1 })).score, 6);
  assert.equal(placeTrust(place({ communityWeight: 10 })).score, 21);
  assert.equal(placeTrust(place({ communityWeight: 100 })).score, 40);
  assert.equal(placeTrust(place({ communityWeight: 10_000 })).score, 40);
  assert.equal(placeTrust(place({ communityWeight: -3 })).score, 0);
});

test("settled facts add 5 for two or three, 10 for all four; a menu adds 5", () => {
  assert.equal(placeTrust(place({ settledFacts: 1 })).score, 0);
  assert.equal(placeTrust(place({ settledFacts: 2 })).score, 5);
  assert.equal(placeTrust(place({ settledFacts: 3 })).score, 5);
  assert.equal(placeTrust(place({ settledFacts: 4 })).score, 10);
  assert.equal(placeTrust(place({ menu: true })).score, 5);
});

test("penalties: reports cost 10 each up to 30, a dispute 15, a burst 20, never below 0", () => {
  const strong = { certificate: true, creators: 3, communityWeight: 100, settledFacts: 4, menu: true };
  assert.equal(placeTrust(place(strong)).score, 100);
  assert.equal(placeTrust(place({ ...strong, communityWeight: 10 })).score, 100);
  assert.equal(placeTrust(place({ certificate: true, openReports: 1 })).score, 30);
  assert.equal(placeTrust(place({ certificate: true, openReports: 5 })).score, 10);
  assert.equal(placeTrust(place({ certificate: true, disputed: true })).score, 25);
  assert.equal(placeTrust(place({ certificate: true, burst: true })).score, 20);
  assert.equal(placeTrust(place({ creators: 1, openReports: 3, disputed: true, burst: true })).score, 0);
});

test("pork on the menu caps trust at 14 and sends the place to review", () => {
  assert.deepEqual(placeTrust(place({ certificate: true, creators: 3, porkOnMenu: true })), {
    score: PORK_CAP,
    band: "unverified",
    review: true,
  });
  assert.deepEqual(placeTrust(place({ communityWeight: 1, porkOnMenu: true })), { score: 6, band: "unverified", review: true });
});

test("bands: 0–14 Unverified, 15–39 Some proof, 40–69 Trusted, 70+ Highly trusted", () => {
  const cases: [number, string][] = [
    [0, "unverified"],
    [14, "unverified"],
    [15, "some_proof"],
    [39, "some_proof"],
    [40, "trusted"],
    [69, "trusted"],
    [70, "highly_trusted"],
    [100, "highly_trusted"],
  ];
  for (const [score, band] of cases) assert.equal(trustBand(score), band, String(score));
  assert.equal(BAND_LABEL[trustBand(20)], "Some proof");
});

const proof = (over: Partial<BadgeProof> = {}): BadgeProof => ({
  certificate: false,
  registryMatch: false,
  countedVouchers: 0,
  creators: 0,
  ownerMuslimOwned: false,
  alcoholOnMenu: false,
  porkOnMenu: false,
  alcoholSettled: null,
  porkSettled: null,
  ...over,
});

test("a place without proof has no badges", () => {
  assert.deepEqual(placeBadges(proof({ alcoholSettled: "no", porkSettled: "no" })), []);
});

test("each badge has its own source", () => {
  assert.deepEqual(placeBadges(proof({ certificate: true })), ["halal_certified"]);
  assert.deepEqual(placeBadges(proof({ registryMatch: true })), ["halal_certified"]);
  assert.deepEqual(placeBadges(proof({ countedVouchers: 1 })), ["community_verified"]);
  assert.deepEqual(placeBadges(proof({ creators: 1 })), ["creator_verified"]);
  assert.deepEqual(placeBadges(proof({ ownerMuslimOwned: true })), ["muslim_owned"]);
  assert.deepEqual(placeBadges(proof({ alcoholOnMenu: true })), ["serves_alcohol"]);
  assert.deepEqual(placeBadges(proof({ alcoholSettled: "yes" })), ["serves_alcohol"]);
  assert.deepEqual(placeBadges(proof({ porkOnMenu: true })), ["serves_pork"]);
  assert.deepEqual(placeBadges(proof({ porkSettled: "yes" })), ["serves_pork"]);
});

test("all badges come out in display order and round-trip through place_status.badges", () => {
  const all = placeBadges(
    proof({ certificate: true, countedVouchers: 3, creators: 2, ownerMuslimOwned: true, alcoholOnMenu: true, porkOnMenu: true }),
  );
  assert.deepEqual(all, [...BADGES]);
  assert.equal(formatBadges(all), "halal_certified,community_verified,creator_verified,muslim_owned,serves_alcohol,serves_pork");
  assert.deepEqual(parseBadges(formatBadges(all)), all);
  assert.deepEqual(parseBadges("serves_pork,bogus,halal_certified"), ["halal_certified", "serves_pork"]);
  assert.deepEqual(parseBadges(""), []);
  assert.deepEqual(parseBadges(null), []);
});

test("New and Restricted members' places wait for review; Member and above go live", () => {
  assert.deepEqual(
    TIERS.filter((tier) => placeAddNeedsReview(tier)),
    ["restricted", "new"],
  );
});
