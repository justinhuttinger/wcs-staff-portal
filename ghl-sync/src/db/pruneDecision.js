// Pure safety-floor decision for opportunity pruning (no DB dependency so it is
// unit-testable). Given how many of a location's rows were refreshed this run
// (alive) out of the total on disk, decide whether to delete the rest as zombies
// GHL no longer returns. Skip when nothing was stamped (the fetch failed) or when
// alive dropped below the ratio — a transient partial fetch must never be allowed
// to mass-delete live opportunities.
const DEFAULT_MIN_ALIVE_RATIO = parseFloat(process.env.OPPS_PRUNE_MIN_ALIVE_RATIO || '0.5');

function decidePrune(total, alive, ratio = DEFAULT_MIN_ALIVE_RATIO) {
  if (!alive || alive === 0) return { prune: false, reason: 'no rows stamped this run (fetch likely failed)' };
  if (total && alive < total * ratio) return { prune: false, reason: `alive ${alive}/${total} below floor ${ratio}` };
  return { prune: true, reason: `alive ${alive}/${total}` };
}

module.exports = { decidePrune, DEFAULT_MIN_ALIVE_RATIO };
