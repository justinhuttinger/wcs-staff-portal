const supabase = require('../db/supabase')
const { planGhosts } = require('./ghostMembers')

// Page size for reading our own held-active rows. PostgREST caps a reply at
// 1,000 rows and the largest club holds ~6,000 active, so this MUST page —
// an unpaged read would silently return the first thousand and every member
// past that would look absent from our own table.
const PAGE = 1000

async function fetchHeldActive(clubNumber) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('abc_members')
      .select('member_id,last_sync_at')
      .eq('club_number', clubNumber)
      .eq('member_status', 'Active')
      // ORDER BY is not decoration here. range() is LIMIT/OFFSET, and without a
      // stable sort Postgres may return rows in a different order per page, so
      // a paged read can silently skip rows and repeat others. A skipped row
      // reads as "we do not hold this member", which is the exact input this
      // function turns into a delete.
      .order('member_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`read held-active failed: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/**
 * Move members ABC no longer returns out of abc_members for one club.
 *
 * Call AFTER the cycle's upserts, so a member who cancelled mid-cycle has
 * already had their row refreshed by the incremental inactive pull and is not
 * mistaken for a member ABC has dropped.
 *
 * @param {object} args
 * @param {string} args.clubNumber
 * @param {Iterable<string>} args.abcMemberIds  every id returned this cycle,
 *   from the active AND inactive pulls
 * @param {string} args.cycleStartedAt  ISO stamp taken before the pulls began
 * @param {boolean} [args.dryRun]  plan and log, change nothing
 */
async function reconcileClubGhosts({ clubNumber, abcMemberIds, cycleStartedAt, dryRun = false }) {
  const heldActive = await fetchHeldActive(clubNumber)
  const plan = planGhosts({
    heldActive,
    abcIds: new Set(abcMemberIds),
    cycleStartedAt,
  })

  if (plan.skipped) {
    // Loud on purpose. This is the rail that stops one bad ABC response from
    // archiving a club, and a silent skip would hide a broken pull for weeks.
    console.warn(
      `[ABC Ghosts] ${clubNumber}: SKIPPED — ABC returned ${plan.abcCount} ids against ` +
      `${plan.heldActiveCount} held active (${(plan.coverage * 100).toFixed(1)}% coverage). ` +
      `Treating this as a bad pull, not a reconciliation.`
    )
    return { club: clubNumber, ghosted: 0, skipped: true, coverage: plan.coverage }
  }

  if (plan.ghostIds.length === 0) {
    return { club: clubNumber, ghosted: 0, skipped: false, coverage: plan.coverage }
  }

  if (dryRun) {
    console.log(`[ABC Ghosts] ${clubNumber}: DRY RUN — would archive ${plan.ghostIds.length} rows`)
    return { club: clubNumber, ghosted: 0, skipped: false, dryRun: true, wouldGhost: plan.ghostIds.length }
  }

  const { data, error } = await supabase.rpc('abc_ghost_members', {
    p_club: clubNumber,
    p_member_ids: plan.ghostIds,
    p_reason: 'absent from ABC member list',
  })
  if (error) throw new Error(`abc_ghost_members failed: ${error.message}`)

  console.log(`[ABC Ghosts] ${clubNumber}: archived ${data} members ABC no longer returns`)
  return { club: clubNumber, ghosted: data || 0, skipped: false, coverage: plan.coverage }
}

module.exports = { reconcileClubGhosts }
