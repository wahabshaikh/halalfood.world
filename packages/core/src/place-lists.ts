/**
 * Personal, optionally ranked collections. A ranked list is presented as one
 * person's ranking, never as a platform verdict, and — per the launch
 * safeguards — a ranked list may only contain places its owner has confirmed
 * visiting.
 */

export const LIST_VISIBILITY = ["public", "unlisted", "private"] as const;
export type ListVisibility = (typeof LIST_VISIBILITY)[number];

export const LIST_CAPTION_MAX = 140;

export type PlaceList = {
  id: string;
  userId: string;
  title: string;
  slug: string;
  description: string | null;
  /** A one-line hook shown on cards and under the title. */
  caption: string | null;
  /** The place whose photo fronts the list. Null falls back to the first place. */
  coverPlaceId: string | null;
  /** The cover actually shown: the chosen place, else the first on the list. */
  displayCoverPlaceId: string | null;
  ranked: boolean;
  visibility: ListVisibility;
  itemCount: number;
  /** How many diners saved the list. Taste, never evidence. */
  saveCount: number;
  createdAt: number;
  updatedAt: number;
};

export type PlaceListItem = {
  placeId: string;
  position: number;
  note: string | null;
};

export type ValidatedList = {
  title: string;
  slug: string;
  description: string | null;
  caption: string | null;
  coverPlaceId: string | null;
  ranked: boolean;
  visibility: ListVisibility;
};

export type ListValidation =
  | { ok: true; data: ValidatedList }
  | { ok: false; error: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugifyListTitle(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "list";
}

export function validateList(input: unknown): ListValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  if (typeof body.title !== "string")
    return { ok: false, error: "Give the list a title." };
  const title = body.title.trim();
  if (!title || title.length > 120)
    return { ok: false, error: "The title must be 1-120 characters." };

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null && body.description !== "") {
    if (typeof body.description !== "string" || body.description.trim().length > 1000)
      return { ok: false, error: "The description must be 1000 characters or fewer." };
    description = body.description.trim() || null;
  }

  let caption: string | null = null;
  if (body.caption !== undefined && body.caption !== null && body.caption !== "") {
    if (
      typeof body.caption !== "string" ||
      body.caption.trim().length > LIST_CAPTION_MAX ||
      /[\u0000-\u001f\u007f]/.test(body.caption)
    )
      return {
        ok: false,
        error: `The caption must be one line of ${LIST_CAPTION_MAX} characters or fewer.`,
      };
    caption = body.caption.trim() || null;
  }

  let coverPlaceId: string | null = null;
  if (body.coverPlaceId !== undefined && body.coverPlaceId !== null && body.coverPlaceId !== "") {
    if (typeof body.coverPlaceId !== "string" || !UUID.test(body.coverPlaceId))
      return { ok: false, error: "The cover must be one of the list's places." };
    coverPlaceId = body.coverPlaceId.toLowerCase();
  }

  const visibility = body.visibility ?? "public";
  if (!(LIST_VISIBILITY as readonly unknown[]).includes(visibility))
    return { ok: false, error: "Visibility must be public, unlisted or private." };

  return {
    ok: true,
    data: {
      title,
      slug: slugifyListTitle(title),
      description,
      caption,
      coverPlaceId,
      ranked: body.ranked !== false,
      visibility: visibility as ListVisibility,
    },
  };
}

export type ListItemInput = { placeId: string; note?: string | null };

export type ListItemsValidation =
  | { ok: true; data: Array<{ placeId: string; note: string | null }> }
  | { ok: false; error: string };

export const MAX_LIST_ITEMS = 200;

/** Positions are derived from array order, so the client never sends indices. */
export function validateListItems(input: unknown): ListItemsValidation {
  if (!Array.isArray(input)) return { ok: false, error: "Send an array of places." };
  if (input.length > MAX_LIST_ITEMS)
    return { ok: false, error: `A list holds at most ${MAX_LIST_ITEMS} places.` };
  const seen = new Set<string>();
  const items: Array<{ placeId: string; note: string | null }> = [];
  for (const raw of input) {
    const entry =
      typeof raw === "string" ? { placeId: raw } : (raw as ListItemInput | null);
    if (!entry || typeof entry.placeId !== "string" || !UUID.test(entry.placeId))
      return { ok: false, error: "Each entry needs a valid place id." };
    const placeId = entry.placeId.toLowerCase();
    if (seen.has(placeId))
      return { ok: false, error: "A place appears twice in the list." };
    seen.add(placeId);
    let note: string | null = null;
    if (entry.note !== undefined && entry.note !== null && entry.note !== "") {
      if (typeof entry.note !== "string" || entry.note.trim().length > 500)
        return { ok: false, error: "Each note must be 500 characters or fewer." };
      note = entry.note.trim() || null;
    }
    items.push({ placeId, note });
  }
  return { ok: true, data: items };
}

/**
 * A ranked list published to others must only contain confirmed visits. This
 * returns the offending ids so the UI can name them instead of failing vaguely.
 */
export function unvisitedRankedEntries(
  items: readonly { placeId: string }[],
  visitedPlaceIds: ReadonlySet<string>,
): string[] {
  return items
    .map((item) => item.placeId)
    .filter((placeId) => !visitedPlaceIds.has(placeId));
}

/* ------------------------------------------------------ collaboration -- */

/** What someone may do with a list they can open. */
export type ListRole = "owner" | "editor" | "viewer";

/** A role, or "invited" while an invite is still unanswered. */
export type ListStanding = ListRole | "invited";

export const MAX_COLLABORATORS = 10;

/** The owner and accepted collaborators add places, leave notes and tick off visits. */
export function canEditItems(role: ListStanding): boolean {
  return role === "owner" || role === "editor";
}

/** Title, visibility, cover, collaborators and the edit link stay with the owner. */
export function canManageList(role: ListStanding): boolean {
  return role === "owner";
}

/**
 * A ranked list is one person's ranking of places they have visited, so it
 * cannot also be a group plan. Group lists are unranked collections.
 */
export function collaborationConflict(list: {
  ranked: boolean;
  visibility: ListVisibility;
}): string | null {
  if (list.ranked)
    return "A ranked list is one person's ranking. Make it unranked to plan it with friends.";
  return null;
}

/** Who may edit through the link is decided by whoever holds a valid token. */
export function isEditToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(value);
}

/** "You've been 3/7": the places on a list the viewer has a recorded visit to. */
export function listProgress(
  items: readonly { placeId: string }[],
  visitedPlaceIds: ReadonlySet<string>,
): { been: number; total: number } {
  let been = 0;
  for (const item of items) if (visitedPlaceIds.has(item.placeId)) been += 1;
  return { been, total: items.length };
}

/** Can this viewer open the list at all? Private lists stay with their people. */
export function canViewList(input: {
  visibility: ListVisibility;
  role: ListStanding | null;
}): boolean {
  if (input.role === "owner" || input.role === "editor" || input.role === "invited")
    return true;
  return input.visibility !== "private";
}

export type CollaboratorInvite =
  | { ok: true; handle: string }
  | { ok: false; error: string };

export function validateCollaboratorInvite(input: unknown): CollaboratorInvite {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const raw = (input as Record<string, unknown>).handle;
  if (typeof raw !== "string") return { ok: false, error: "Pick someone by handle." };
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/.test(handle))
    return { ok: false, error: "That is not a valid handle." };
  return { ok: true, handle };
}

/** One place added by hand to a list. */
export function validateListItem(
  input: unknown,
): { ok: true; placeId: string; note: string | null } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;
  const checked = validateListItems([{ placeId: body.placeId, note: body.note as string | null }]);
  if (!checked.ok) return checked;
  return { ok: true, placeId: checked.data[0].placeId, note: checked.data[0].note };
}
