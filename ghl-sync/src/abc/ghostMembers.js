// ---------------------------------------------------------------------------
// Ghost members: rows we hold that ABC no longer returns.
//
// abc_members is upsert-only. Nothing has ever removed a row, so when ABC drops
// a member — transferred to another club, deleted, merged — our row freezes at
// whatever it last said and KEEPS COUNTING AS ACTIVE. Measured 2026-09-07:
// 356 such rows, 325 of them still reading Active. 100 of those are people who
// moved club and are active at the new one too, so they were counted twice in
// every company-wide total.
//
// They are identifiable because ABC's member list is the authority: the sync
// does a FULL active pull per club every cycle, so any row we hold as active
// that the cycle did not refresh is a row ABC did not hand back.
//
// TWO CONDITIONS, BOTH REQUIRED, because either alone has a false positive:
//
//   not refreshed this cycle  — a stale stamp alone could mean the upsert
//                               failed, and archiving a live member over a
//                               failed write would be much worse than the bug
//   absent from the ABC ids   — a member who cancels mid-cycle drops off the
//                               active pull but lands on the incremental
//                               inactive pull in the same run, so they are
//                               present and must not be mistaken for a ghost
//
// The coverage floor is the rail that matters. One truncated or failed ABC
// response would otherwise archive an entire club in a single run, and that is
// exactly the kind of destructive action a sync should never be able to take on
// its own. Below the floor it does nothing at all and says so.
// ---------------------------------------------------------------------------

/** Fraction of our held-active rows ABC must return before we trust the pull. */
const DEFAULT_COVERAGE_FLOOR = 0.5

/**
 * Decide which held-active rows are ghosts.
 *
 * Pure: no database, no network, so the rules above can be tested directly.
 *
 * @param {object}   args
 * @param {Array<{member_id: string, last_sync_at: ?string}>} args.heldActive
 *   Rows we currently hold as member_status='Active' for one club.
 * @param {Set<string>} args.abcIds  Every member id ABC returned this cycle,
 *   from BOTH the active and the incremental inactive pull.
 * @param {string}   args.cycleStartedAt  ISO timestamp taken before the pulls.
 * @param {number}  [args.coverageFloor]
 * @returns {{ghostIds: string[], skipped: boolean, reason: ?string,
 *            coverage: number, heldActiveCount: number, abcCount: number}}
 */
function planGhosts({ heldActive, abcIds, cycleStartedAt, coverageFloor = DEFAULT_COVERAGE_FLOOR }) {
  const rows = Array.isArray(heldActive) ? heldActive : []
  const ids = abcIds instanceof Set ? abcIds : new Set(abcIds || [])

  const heldActiveCount = rows.length
  const abcCount = ids.size
  // Holding nothing is not a failed pull, and dividing by it would report NaN
  // and skip forever. A club with no active members has nothing to archive.
  const coverage = heldActiveCount === 0 ? 1 : abcCount / heldActiveCount

  const base = { coverage, heldActiveCount, abcCount }

  if (coverage < coverageFloor) {
    return { ...base, ghostIds: [], skipped: true, reason: 'coverage' }
  }

  const cycleStart = Date.parse(cycleStartedAt)
  const ghostIds = rows
    .filter(r => {
      if (ids.has(r.member_id)) return false
      // A null or unparseable stamp cannot be newer than the cycle, so it is
      // not refreshed. Left to NaN comparison it would fall out of both sides.
      const stamp = r.last_sync_at ? Date.parse(r.last_sync_at) : NaN
      return !(stamp >= cycleStart)
    })
    .map(r => r.member_id)

  return { ...base, ghostIds, skipped: false, reason: null }
}

module.exports = { planGhosts, DEFAULT_COVERAGE_FLOOR }
