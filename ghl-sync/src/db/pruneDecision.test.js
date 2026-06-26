const { test } = require('node:test');
const assert = require('node:assert');
const { decidePrune } = require('./pruneDecision');

// The safety floor exists so a transient partial GHL fetch can never mass-delete a
// location's live opportunities. These cases pin that behavior down.

test('prunes when the full set was refreshed (alive == total)', () => {
  // Salem real case: 2277 alive out of 2484 -> 207 zombies pruned.
  const d = decidePrune(2484, 2277);
  assert.strictEqual(d.prune, true);
});

test('skips when nothing was stamped this run (fetch failed -> alive 0)', () => {
  assert.strictEqual(decidePrune(2484, 0).prune, false);
  assert.strictEqual(decidePrune(2484, undefined).prune, false);
});

test('skips when alive dropped below the floor (transient partial fetch)', () => {
  // Only ~40% of the location came back this run — do NOT delete the other 60%.
  assert.strictEqual(decidePrune(1000, 400).prune, false);
});

test('prunes right at the floor boundary', () => {
  assert.strictEqual(decidePrune(1000, 500).prune, true); // 500 == 1000 * 0.5, not below
  assert.strictEqual(decidePrune(1000, 499).prune, false); // just below
});

test('prunes a healthy fresh location with no zombies (alive == total)', () => {
  assert.strictEqual(decidePrune(300, 300).prune, true);
});

test('custom ratio is honored', () => {
  assert.strictEqual(decidePrune(100, 80, 0.9).prune, false); // 80 < 90
  assert.strictEqual(decidePrune(100, 95, 0.9).prune, true);
});
