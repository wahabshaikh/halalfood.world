/**
 * Page loaders separate "this row does not exist" (a real 404) from "the
 * database is unreachable" (transient). They are different outcomes for a
 * crawler: the first is permanent, the second must never be indexed as if it
 * were the page's content.
 */
export type Loaded<T> =
  | { status: "ok"; data: T }
  | { status: "missing" }
  | { status: "error" };

export async function loadOrDegrade<T>(
  read: () => Promise<T | null | undefined>,
): Promise<Loaded<T>> {
  try {
    const data = await read();
    return data === null || data === undefined
      ? { status: "missing" }
      : { status: "ok", data };
  } catch {
    // The reason is deliberately dropped — it can carry connection details.
    return { status: "error" };
  }
}
