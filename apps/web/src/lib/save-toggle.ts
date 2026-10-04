/**
 * The heart only moves after the server answers. A failed removal puts the
 * button back and explains why, so the label cannot disagree with Saved.
 */
export function nextSaveState(
  previous: boolean,
  requested: boolean,
  response: { ok: boolean; saved?: boolean },
): { saved: boolean; error: string | null } {
  if (!response.ok || typeof response.saved !== "boolean") {
    return {
      saved: previous,
      error: "Could not update saved places. Please try again.",
    };
  }
  if (response.saved !== requested) {
    return {
      saved: response.saved,
      error: "The saved list did not change. Please try again.",
    };
  }
  return { saved: response.saved, error: null };
}
