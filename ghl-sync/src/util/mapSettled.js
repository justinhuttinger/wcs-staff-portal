// Run an async fn over items with bounded concurrency. Never rejects: each item
// resolves to { status:'fulfilled', value } or { status:'rejected', reason }
// (same shape as Promise.allSettled), so one item's failure can't abort the rest.
// Result order always matches the input order.
async function mapSettled(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

module.exports = { mapSettled };
