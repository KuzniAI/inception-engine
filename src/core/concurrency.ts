import os from "node:os";

export const DEFAULT_BOUNDED_CONCURRENCY = Math.max(
  1,
  Math.min(8, os.availableParallelism()),
);

export async function mapConcurrentOrdered<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: {
    concurrency?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Array<R | undefined>> {
  const { signal } = options;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_BOUNDED_CONCURRENCY, items.length),
  );
  const results = new Array<R | undefined>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal?.aborted) return;
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}
