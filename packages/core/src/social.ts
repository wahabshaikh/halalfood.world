/**
 * The social graph: handles, follows, blocks and the onboarding standard.
 *
 * Taste is social, halal status is not. Nothing here can change a place's
 * status: follows and blocks decide whose visits and lists a person sees, and
 * the onboarding standard only writes the same thresholds the dietary
 * standards page already edits.
 */

import type { MinimumStatus, UserPreferences } from "./user-preferences";

/* --------------------------------------------------------------- handles -- */

/** Same shape the public profile route already accepts: 3-32 characters. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

/** Names that would read as the site itself or as a moderator. */
export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "administrator",
  "halalfood",
  "moderator",
  "mod",
  "support",
  "help",
  "team",
  "staff",
  "official",
  "root",
  "system",
  "me",
  "you",
];

export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return handle || null;
}

export type HandleValidation = { ok: true; handle: string } | { ok: false; error: string };

export function validateHandle(value: unknown): HandleValidation {
  const handle = normalizeHandle(value);
  if (!handle || !HANDLE_PATTERN.test(handle))
    return {
      ok: false,
      error: "Handles are 3-32 characters: letters, numbers, - and _.",
    };
  if (RESERVED_HANDLES.includes(handle))
    return { ok: false, error: "That handle is reserved. Try another." };
  // Fallback handles look like diner-1a2b3c4d5e; keep that space for them so a
  // chosen handle can never collide with a future derived one.
  if (/^diner-[0-9a-f]{10}$/.test(handle))
    return { ok: false, error: "Choose a handle of your own." };
  return { ok: true, handle };
}

export const DISPLAY_NAME_MAX = 60;

export type DisplayNameValidation =
  | { ok: true; displayName: string }
  | { ok: false; error: string };

export function validateDisplayName(value: unknown): DisplayNameValidation {
  if (typeof value !== "string") return { ok: false, error: "Enter your name." };
  // Collapse runs of whitespace and strip control characters.
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > DISPLAY_NAME_MAX)
    return {
      ok: false,
      error: `Names are ${DISPLAY_NAME_MAX} characters or fewer.`,
    };
  return { ok: true, displayName: name };
}

/**
 * Where a profile photo is served from. The version is the file name of the
 * stored key, so uploading a new photo busts the cache.
 */
export function avatarUrl(handle: string, avatarKey: string | null): string | null {
  if (!avatarKey) return null;
  const version = avatarKey.split("/").pop()?.split(".")[0] ?? "";
  return `/api/avatars/${encodeURIComponent(handle)}?v=${encodeURIComponent(version)}`;
}

/* --------------------------------------------------------------- follows -- */

export type FollowStatus = "pending" | "accepted";

/** How the viewer stands to a profile they are looking at. */
export type Relation = "self" | "following" | "requested" | "none" | "blocked";

export type FollowDecision =
  | { action: "follow"; status: FollowStatus }
  | { action: "noop"; status: FollowStatus }
  | { action: "reject"; reason: "self" | "blocked" };

/**
 * What following someone should do. A private account turns a follow into a
 * request; a public one is accepted straight away. A block in either direction
 * refuses the follow without saying who blocked whom.
 */
export function decideFollow(input: {
  followerId: string;
  followeeId: string;
  followeeIsPrivate: boolean;
  blockedEitherWay: boolean;
  existing: FollowStatus | null;
}): FollowDecision {
  if (input.followerId === input.followeeId) return { action: "reject", reason: "self" };
  if (input.blockedEitherWay) return { action: "reject", reason: "blocked" };
  if (input.existing) return { action: "noop", status: input.existing };
  return { action: "follow", status: input.followeeIsPrivate ? "pending" : "accepted" };
}

export function relationOf(input: {
  viewerId: string | null;
  profileUserId: string;
  blockedEitherWay: boolean;
  follow: FollowStatus | null;
}): Relation {
  if (input.viewerId && input.viewerId === input.profileUserId) return "self";
  if (input.blockedEitherWay) return "blocked";
  if (input.follow === "accepted") return "following";
  if (input.follow === "pending") return "requested";
  return "none";
}

export type ProfileAccess = {
  /** Show the profile card: name, handle, photo and bio. */
  showsIdentity: boolean;
  /** Show visits and lists, subject to the owner's own visibility settings. */
  showsActivity: boolean;
  /** Offer a follow (or follow request) button. */
  canFollow: boolean;
};

/**
 * Who sees what on a profile. A blocked viewer gets nothing at all, and a
 * private account keeps its activity to accepted followers.
 */
export function profileAccess(relation: Relation, profileIsPrivate: boolean): ProfileAccess {
  if (relation === "blocked")
    return { showsIdentity: false, showsActivity: false, canFollow: false };
  if (relation === "self")
    return { showsIdentity: true, showsActivity: true, canFollow: false };
  return {
    showsIdentity: true,
    showsActivity: !profileIsPrivate || relation === "following",
    canFollow: relation === "none",
  };
}

/* ------------------------------------------------------- halal standard -- */

export const STANDARD_PRESETS = ["certified", "community", "options"] as const;
export type StandardPreset = (typeof STANDARD_PRESETS)[number];

export const STANDARD_PRESET_COPY: Record<
  StandardPreset,
  { label: string; hint: string; minimumStatus: MinimumStatus; requireCertification: boolean }
> = {
  certified: {
    label: "Certified only",
    hint: "Verified halal with a named body",
    minimumStatus: "verified",
    requireCertification: true,
  },
  community: {
    label: "Community verified is fine",
    hint: "Two or more diners confirmed",
    minimumStatus: "community-verified",
    requireCertification: false,
  },
  options: {
    label: "Halal options are fine",
    hint: "Some dishes, clearly marked",
    minimumStatus: "halal-options",
    requireCertification: false,
  },
};

export type OnboardingStandard = {
  preset: StandardPreset;
  avoidAlcohol: boolean;
  preferHandSlaughter: boolean;
};

export const DEFAULT_ONBOARDING_STANDARD: OnboardingStandard = {
  preset: "community",
  avoidAlcohol: false,
  preferHandSlaughter: false,
};

/**
 * Apply the three onboarding questions on top of a person's existing
 * preferences. Only the fields the step asks about change; allergies, cuisines
 * and the rest of the dietary standards page are left alone.
 */
export function applyOnboardingStandard(
  base: UserPreferences,
  standard: OnboardingStandard,
): UserPreferences {
  const preset = STANDARD_PRESET_COPY[standard.preset];
  return {
    ...base,
    minimumStatus: preset.minimumStatus,
    requireCertification: preset.requireCertification,
    avoidAlcohol: standard.avoidAlcohol,
    preferHandSlaughter: standard.preferHandSlaughter,
  };
}

/** Best label for preferences set elsewhere, for showing the current standard. */
export function describeStandard(preferences: UserPreferences): string {
  const preset = STANDARD_PRESETS.find(
    (key) =>
      STANDARD_PRESET_COPY[key].minimumStatus === preferences.minimumStatus &&
      STANDARD_PRESET_COPY[key].requireCertification === preferences.requireCertification,
  );
  const parts: string[] = [
    preset ? STANDARD_PRESET_COPY[preset].label : "Custom standard",
  ];
  if (preferences.avoidAlcohol) parts.push("No alcohol");
  if (preferences.preferHandSlaughter) parts.push("Zabiha");
  return parts.join(" · ");
}

/* ------------------------------------------------------------ onboarding -- */

export const ONBOARDING_STEPS = [
  "welcome",
  "profile",
  "standard",
  "picks",
  "friends",
  "ready",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps a person may skip. Name and handle are the only required answers. */
export const SKIPPABLE_STEPS: readonly OnboardingStep[] = [
  "welcome",
  "standard",
  "picks",
  "friends",
];

export const MAX_WANT_TO_TRY = 3;

export type OnboardingInput = {
  displayName: string;
  handle: string;
  standard: OnboardingStandard | null;
  homeCitySlug: string | null;
  wantToTry: string[];
  invitedByHandle: string | null;
};

export type OnboardingValidation =
  | { ok: true; data: OnboardingInput }
  | { ok: false; error: string };

const CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateOnboarding(input: unknown): OnboardingValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  const name = validateDisplayName(body.displayName);
  if (!name.ok) return name;
  const handle = validateHandle(body.handle);
  if (!handle.ok) return handle;

  let standard: OnboardingStandard | null = null;
  if (body.standard !== undefined && body.standard !== null) {
    const raw = body.standard as Record<string, unknown>;
    if (typeof raw !== "object" || Array.isArray(raw))
      return { ok: false, error: "Choose a halal standard." };
    if (!STANDARD_PRESETS.includes(raw.preset as StandardPreset))
      return { ok: false, error: "Choose one of the halal standards offered." };
    standard = {
      preset: raw.preset as StandardPreset,
      avoidAlcohol: raw.avoidAlcohol === true,
      preferHandSlaughter: raw.preferHandSlaughter === true,
    };
  }

  let homeCitySlug: string | null = null;
  if (body.homeCitySlug !== undefined && body.homeCitySlug !== null && body.homeCitySlug !== "") {
    if (
      typeof body.homeCitySlug !== "string" ||
      body.homeCitySlug.length > 120 ||
      !CITY_SLUG.test(body.homeCitySlug)
    )
      return { ok: false, error: "Home city must be a valid city slug." };
    homeCitySlug = body.homeCitySlug;
  }

  const wantToTry: string[] = [];
  if (body.wantToTry !== undefined && body.wantToTry !== null) {
    if (!Array.isArray(body.wantToTry))
      return { ok: false, error: "Places to try must be a list." };
    if (body.wantToTry.length > MAX_WANT_TO_TRY)
      return { ok: false, error: `Pick at most ${MAX_WANT_TO_TRY} places.` };
    for (const id of body.wantToTry) {
      if (typeof id !== "string" || !PLACE_ID.test(id))
        return { ok: false, error: "Places to try must be place ids." };
      const lower = id.toLowerCase();
      if (!wantToTry.includes(lower)) wantToTry.push(lower);
    }
  }

  let invitedByHandle: string | null = null;
  if (body.invitedByHandle !== undefined && body.invitedByHandle !== null && body.invitedByHandle !== "") {
    const inviter = normalizeHandle(body.invitedByHandle);
    if (!inviter || !HANDLE_PATTERN.test(inviter))
      return { ok: false, error: "That invite link is not valid." };
    invitedByHandle = inviter;
  }

  return {
    ok: true,
    data: { displayName: name.displayName, handle: handle.handle, standard, homeCitySlug, wantToTry, invitedByHandle },
  };
}

/* --------------------------------------------------------------- invites -- */

/** The public link a diner shares. It only names the inviter: no token, no data. */
export function inviteLink(handle: string, origin = "https://halalfood.world"): string {
  return `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(handle)}`;
}

