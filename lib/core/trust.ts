/**
 * Community trust: how much real-world proof stands behind a listing.
 *
 * Trust never touches the four facts or the halal status; those stay with
 * `lib/core/halal.ts` (docs/spec/halal-model.md). Ratings, points, follows
 * and sponsorship never feed trust either. Three pure rules:
 *
 * - `memberTrust`: a member's tier and vouch weight, from their account and
 *   contribution record. `vouchWeight` applies the per-vouch modifiers and
 *   `dampClusters` the same-network rule.
 * - `placeTrust`: a place's 0–100 score and its band, from proof, creators,
 *   counted vouches, settled facts, a menu and penalties. Pork on the menu
 *   caps it at 14 and sends the place to review.
 * - `placeBadges`: the badges a place has earned. Nothing a single member
 *   does makes a place "Halal Certified" or "Muslim owned".
 */
import { ACCOUNT_AGE_MS } from "./halal";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const TIERS = ["restricted", "new", "member", "trusted", "moderator"] as const;
export type Tier = (typeof TIERS)[number];

/** Vouch weight per tier. Restricted members are logged but not counted. */
export const TIER_WEIGHT: Record<Tier, number> = {
  restricted: 0,
  new: 0.5,
  member: 1,
  trusted: 1.5,
  moderator: 2,
};

export function parseTier(value: unknown): Tier | null {
  return TIERS.find((name) => name === value) ?? null;
}

/** A member's record, counted by the caller. Windows are relative to now. */
export type MemberRecord = {
  createdAt: number;
  emailVerified: boolean;
  suspended: boolean;
  moderator: boolean;
  /** Has a claimed creator profile. */
  creator: boolean;
  /** Accepted contributions, ever. */
  accepted: number;
  /** Distinct places across the accepted contributions. */
  acceptedPlaces: number;
  /** Rejected contributions, ever. */
  rejected: number;
  rejected30d: number;
  upheldReports90d: number;
};

/**
 * The member's tier and weight (spec §2.2). A suspension restricts anyone,
 * moderators included. A claimed creator is at least Member unless restricted.
 */
export function memberTrust(member: MemberRecord, now: number): { tier: Tier; weight: number } {
  const tier = memberTier(member, now);
  return { tier, weight: TIER_WEIGHT[tier] };
}

function memberTier(member: MemberRecord, now: number): Tier {
  if (member.suspended) return "restricted";
  if (member.moderator) return "moderator";
  const age = now - member.createdAt;
  if (age < ACCOUNT_AGE_MS || member.rejected30d >= 3 || !member.emailVerified) return "restricted";
  const reviewed = member.accepted + member.rejected;
  if (
    age >= 30 * DAY_MS &&
    member.accepted >= 15 &&
    member.accepted / reviewed >= 0.9 &&
    member.upheldReports90d === 0
  ) {
    return "trusted";
  }
  if ((age >= 7 * DAY_MS && member.accepted >= 3 && member.acceptedPlaces >= 2) || member.creator) return "member";
  return "new";
}

/** Facts about one vouch that change how much it counts. */
export type VouchContext = {
  /** The voucher's account age when they vouched. */
  accountAgeMs: number;
  /** The person who invited the voucher added this place. */
  placeAddedByInviter: boolean;
  /** The voucher is the place's verified owner. */
  verifiedOwner: boolean;
};

/**
 * One vouch's weight after modifiers (spec §2.2): an owner vouching for
 * their own place counts 0, and an invitee vouching for a place their inviter
 * added counts half for their first 30 days.
 */
export function vouchWeight(memberWeight: number, vouch: VouchContext): number {
  if (vouch.verifiedOwner) return 0;
  const ring = vouch.placeAddedByInviter && vouch.accountAgeMs < 30 * DAY_MS ? 0.5 : 1;
  return Math.max(0, memberWeight * ring);
}

/** A vouch on one place as cluster damping sees it. */
export type NetworkVouch = { userId: string; weight: number; ipHash: string | null; at: number };

/**
 * Cluster damping (spec §2.2): when 3 or more vouches on the same place come
 * from the same hashed IP /24 within 24 hours, only the highest-weight one
 * counts. Returns the vouches with the others set to 0, in the order given,
 * and the user ids of each cluster for the moderation queue.
 */
export function dampClusters<V extends NetworkVouch>(vouches: readonly V[]): { vouches: V[]; clusters: string[][] } {
  const muted = new Set<V>();
  const clusters: string[][] = [];
  const byNetwork = new Map<string, V[]>();
  for (const vouch of vouches) {
    if (vouch.ipHash) byNetwork.set(vouch.ipHash, [...(byNetwork.get(vouch.ipHash) ?? []), vouch]);
  }
  for (const group of byNetwork.values()) {
    const sorted = [...group].sort((a, b) => a.at - b.at);
    let start = 0;
    while (start < sorted.length) {
      let end = start;
      while (end + 1 < sorted.length && sorted[end + 1].at - sorted[start].at < DAY_MS) end += 1;
      if (end - start + 1 >= 3) {
        const cluster = sorted.slice(start, end + 1);
        const kept = cluster.reduce((best, vouch) => (vouch.weight > best.weight ? vouch : best));
        for (const vouch of cluster) if (vouch !== kept) muted.add(vouch);
        clusters.push(cluster.map((vouch) => vouch.userId));
        start = end + 1;
      } else {
        start += 1;
      }
    }
  }
  return { vouches: vouches.map((vouch) => (muted.has(vouch) ? { ...vouch, weight: 0 } : vouch)), clusters };
}

/** The last three counted vouches all came from New-tier accounts within one hour (spec §2.3). */
export function isBurst(counted: readonly { tier: Tier; at: number }[]): boolean {
  const last = [...counted].sort((a, b) => b.at - a.at).slice(0, 3);
  return last.length === 3 && last.every((vouch) => vouch.tier === "new") && last[0].at - last[2].at <= HOUR_MS;
}

export const BANDS = ["unverified", "some_proof", "trusted", "highly_trusted"] as const;
export type Band = (typeof BANDS)[number];

export const BAND_LABEL: Record<Band, string> = {
  unverified: "Unverified",
  some_proof: "Some proof",
  trusted: "Trusted",
  highly_trusted: "Highly trusted",
};

export function parseBand(value: unknown): Band | null {
  return BANDS.find((name) => name === value) ?? null;
}

/** Bands are shown as words, never just a number: 0–14, 15–39, 40–69, 70+. */
export function trustBand(score: number): Band {
  if (score >= 70) return "highly_trusted";
  if (score >= 40) return "trusted";
  if (score >= 15) return "some_proof";
  return "unverified";
}

/** The highest score a place with pork on its menu can have: always Unverified. */
export const PORK_CAP = 14;

/** What the place trust score reads, gathered by the caller. */
export type PlaceProof = {
  /** An approved, unexpired certificate. */
  certificate: boolean;
  /** A match in an official certifier registry. */
  registryMatch: boolean;
  /** Distinct creators with a video verification. */
  creators: number;
  /** Σ w over distinct counted vouchers, after modifiers and cluster damping. */
  communityWeight: number;
  /** Facts settled by the halal engine, 0–4. */
  settledFacts: number;
  /** An approved menu exists. */
  menu: boolean;
  /** Open, credible reports. */
  openReports: number;
  /** Any fact is disputed. */
  disputed: boolean;
  /** `isBurst` over the counted vouches. */
  burst: boolean;
  /** An approved menu or menu check found pork. */
  porkOnMenu: boolean;
};

/**
 * The place trust score, 0–100, and its band (spec §2.3). `review` is true
 * when the place must go to the moderation queue (pork on the menu).
 */
export function placeTrust(place: PlaceProof): { score: number; band: Band; review: boolean } {
  const proof = place.certificate || place.registryMatch ? 40 : 0;
  const creator = place.creators > 0 ? Math.min(25, 15 + 5 * (place.creators - 1)) : 0;
  const community = Math.min(40, 6 * Math.log2(1 + Math.max(0, place.communityWeight)));
  const facts = place.settledFacts >= 4 ? 10 : place.settledFacts >= 2 ? 5 : 0;
  const menu = place.menu ? 5 : 0;
  const penalties =
    -Math.min(30, 10 * place.openReports) - (place.disputed ? 15 : 0) - (place.burst ? 20 : 0);
  let score = Math.round(Math.min(100, Math.max(0, proof + creator + community + facts + menu + penalties)));
  if (place.porkOnMenu) score = Math.min(score, PORK_CAP);
  return { score, band: trustBand(score), review: place.porkOnMenu };
}

/** Place badges, in display order. Stable strings: add, never repurpose. */
export const BADGES = [
  "halal_certified",
  "community_verified",
  "creator_verified",
  "muslim_owned",
  "serves_alcohol",
  "serves_pork",
] as const;
export type Badge = (typeof BADGES)[number];

export const BADGE_LABEL: Record<Badge, string> = {
  halal_certified: "Halal Certified",
  community_verified: "Community verified",
  creator_verified: "Creator verified",
  muslim_owned: "Muslim owned",
  serves_alcohol: "Serves alcohol",
  serves_pork: "Serves pork",
};

/** What the badges read, gathered by the caller. */
export type BadgeProof = {
  certificate: boolean;
  registryMatch: boolean;
  /** Distinct vouchers with weight above 0. */
  countedVouchers: number;
  creators: number;
  /** An approved owner claim with Muslim-owned proof. Community answers alone never earn the badge. */
  ownerMuslimOwned: boolean;
  alcoholOnMenu: boolean;
  porkOnMenu: boolean;
  /** The settled alcohol and pork facts from the halal engine. */
  alcoholSettled: "yes" | "no" | null;
  porkSettled: "yes" | "no" | null;
};

/** The badges a place has earned (spec §2.4). A place without proof shows none. */
export function placeBadges(place: BadgeProof): Badge[] {
  const earned: Record<Badge, boolean> = {
    halal_certified: place.certificate || place.registryMatch,
    community_verified: place.countedVouchers > 0,
    creator_verified: place.creators > 0,
    muslim_owned: place.ownerMuslimOwned,
    serves_alcohol: place.alcoholOnMenu || place.alcoholSettled === "yes",
    serves_pork: place.porkOnMenu || place.porkSettled === "yes",
  };
  return BADGES.filter((badge) => earned[badge]);
}

/** `place_status.badges`: comma-separated, like the *_sources columns. */
export function formatBadges(badges: readonly Badge[]): string {
  return badges.join(",");
}

export function parseBadges(value: unknown): Badge[] {
  if (typeof value !== "string" || !value) return [];
  const wanted = new Set(value.split(","));
  return BADGES.filter((badge) => wanted.has(badge));
}

const PROOF_BADGES: ReadonlySet<Badge> = new Set(["halal_certified", "community_verified", "creator_verified", "muslim_owned"]);

/** Proof about the place itself; Serves alcohol and Serves pork are warnings, not proof. */
export function isProofBadge(badge: Badge): boolean {
  return PROOF_BADGES.has(badge);
}

/**
 * The badges a card or place page shows. An imported place nobody has verified to exist (the "Unverified" label,
 * lib/core/provenance.ts) shows none until it earns a proof badge (spec §2.4).
 */
export function shownBadges(badges: readonly Badge[], unverified: boolean): Badge[] {
  return unverified && !badges.some(isProofBadge) ? [] : [...badges];
}

/** Badges a card shows beside its fact tags: a warning the settled fact already says ("Serves pork") isn't repeated. */
export function cardBadges(badges: readonly Badge[], facts: { pork: "yes" | "no" | null; alcohol: "yes" | "no" | null }): Badge[] {
  return badges.filter(
    (badge) => !(badge === "serves_pork" && facts.pork === "yes") && !(badge === "serves_alcohol" && facts.alcohol === "yes"),
  );
}

/** How a voucher is named: their @handle, or their name when they have no profile yet. */
export function voucherName(person: { handle: string | null; name: string }): string {
  return person.handle ? `@${person.handle}` : person.name;
}

/**
 * "Verified by @a and 2 more" (spec §2.4). `first` is the first voucher the viewer may see, `total` every counted
 * vouch, so people the viewer can't see are counted but never named. Null when nobody has vouched.
 */
export function verifiedByLine(first: string | null, total: number): string | null {
  if (total <= 0) return null;
  if (!first) return `Verified by ${total} ${total === 1 ? "member" : "members"}`;
  return total === 1 ? `Verified by ${first}` : `Verified by ${first} and ${total - 1} more`;
}
