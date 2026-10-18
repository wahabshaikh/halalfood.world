/**
 * Batch plumbing for the Scout tools: a bounded worker pool, so a batch never
 * runs more than a few items at once, and a keyed lock, so two items with the
 * same dedupe key run one after the other and the second sees the first's row
 * instead of creating a duplicate.
 */

/** Items per batch call. Keeps one call well inside a Worker's subrequest and time budget. */
export const MAX_BATCH = 25;
/** Items in flight at once within a batch. */
export const BATCH_CONCURRENCY = 5;

export async function mapBounded<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class KeyedLock {
  #tails = new Map<string, Promise<unknown>>();

  /** Runs `fn` after every earlier holder of any of `keys` has finished. */
  async run<R>(keys: readonly string[], fn: () => Promise<R>): Promise<R> {
    const unique = [...new Set(keys)];
    const before = unique.map((key) => this.#tails.get(key) ?? Promise.resolve());
    const result = Promise.all(before).then(fn, fn);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    for (const key of unique) this.#tails.set(key, settled);
    try {
      return await result;
    } finally {
      for (const key of unique) if (this.#tails.get(key) === settled) this.#tails.delete(key);
    }
  }
}
