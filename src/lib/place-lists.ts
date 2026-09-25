/**
 * Personal, optionally ranked collections. A ranked list is presented as one
 * person's ranking, never as a platform verdict, and — per the launch
 * safeguards — a ranked list may only contain places its owner has confirmed
 * visiting.
 */

export const LIST_VISIBILITY = ["public", "unlisted", "private"] as const;
export type ListVisibility = (typeof LIST_VISIBILITY)[number];

export type PlaceList = {
  id: string;
  userId: string;
  title: string;
  slug: string;
  description: string | null;
  ranked: boolean;
  visibility: ListVisibility;
  itemCount: number;
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
  ranked: boolean;
  visibility: ListVisibility;
};

export type ListValidation =
  | { ok: true; data: ValidatedList }
  | { ok: false; error: string };

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

  const visibility = body.visibility ?? "public";
  if (!(LIST_VISIBILITY as readonly unknown[]).includes(visibility))
    return { ok: false, error: "Visibility must be public, unlisted or private." };

  return {
    ok: true,
    data: {
      title,
      slug: slugifyListTitle(title),
      description,
      ranked: body.ranked !== false,
      visibility: visibility as ListVisibility,
    },
  };
}

export type ListItemInput = { placeId: string; note?: string | null };

export type ListItemsValidation =
  | { ok: true; data: Array<{ placeId: string; note: string | null }> }
  | { ok: false; error: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
