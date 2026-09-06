// Bounded-concurrency map.
//
// Lives on its own, with no imports, because what it guarantees is a safety
// property: a reading fans out into hundreds of vendor calls, and an unbounded
// fan-out trips every rate limit at once. A guarantee that load-bearing should
// be testable without a database or a key.

/**
 * Run `fn` over `items`, never more than `limit` at once, preserving order.
 *
 * Results are written back by index rather than pushed, so the output lines up
 * with the input regardless of which task finishes first. A push-based version
 * returns results in completion order, which silently misattributes every
 * result to the wrong item the moment one call is slower than another - and
 * since every call here is a network request, that is always.
 *
 * A rejection propagates. Callers that need per-item tolerance catch inside
 * `fn`, which is what run-panel does: one engine refusing one prompt records a
 * failed answer rather than abandoning a reading already paid for.
 */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  if (!items.length) return out;

  let cursor = 0;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));

  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return out;
}
