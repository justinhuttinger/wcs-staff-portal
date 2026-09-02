// Pure shaping for Analytics > PT Scorecard. No I/O; the route fetches.
//
// GOALS
//
// Book, Show and Close each carry an adjustable goal percentage, and each goal
// applies to the SAME denominator as its rate — reverse-engineered from the
// source dashboard and confirmed against its own figures:
//
//   Book Goal  = new members x goal%     (312 = 445 x 70%)
//   Show Goal  = sets to date x goal%    ( 40 =  81 x 50%)
//   Close Goal = shows x goal%           ( 23 =  76 x 30%)
//
// So a goal is "of the people who reached the previous step", not a share of
// some other total. All three default to 50%.
//
// Every other Goal column in that dashboard is deliberately absent: Justin does
// not run revenue or draft goals, so building them would invent targets.

const GOAL_KEYS = ['book', 'show', 'close']
const DEFAULT_GOAL_PCT = 50

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(v) {
  return v === null ? null : Math.round(v * 100) / 100
}

/** A rate with no denominator is unknown, not zero — a club with no sets has no show rate. */
function pct(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

/**
 * A goal count is only meaningful where the denominator exists.
 *
 * Rounds half to EVEN, which is what the source dashboard does: 445 x 70% =
 * 311.5 shows as 312, while 81 x 50% = 40.5 shows as 40. Plain Math.round sends
 * both up and gets the second wrong. Half-to-even also stops a long column of
 * .5 cases drifting systematically high.
 */
function goalCount(base, goalPct) {
  if (!base) return null
  const exact = base * (goalPct / 100)
  const floor = Math.floor(exact)
  const frac = exact - floor
  if (frac > 0.5) return floor + 1
  if (frac < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

function normalizeGoals(input = {}) {
  const out = {}
  for (const key of GOAL_KEYS) {
    const given = input[key]
    // Missing must fall back to the default rather than be coerced: Number(null)
    // and Number('') are both 0, which would silently set the goal to zero and
    // make every diff column look like a runaway success.
    const raw = (given === null || given === undefined || given === '') ? NaN : Number(given)
    // Clamped: a goal outside 0-100 is a typo, and a NaN would poison every
    // derived column silently.
    out[key] = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : DEFAULT_GOAL_PCT
  }
  return out
}

function buildRow(r, goals, clubNameFor) {
  const newMembers = num(r.new_members)
  const book = num(r.book_count)
  const setToDate = num(r.set_to_date)
  const show = num(r.show_count)
  const close = num(r.close_count)

  const bookGoal = goalCount(newMembers, goals.book)
  const showGoal = goalCount(setToDate, goals.show)
  const closeGoal = goalCount(show, goals.close)

  const newEft = round2(num(r.new_eft_draft))
  const cancelledEft = round2(num(r.cancelled_eft_draft))

  return {
    clubNumber: r.club_number,
    club: clubNameFor(r.club_number),

    ptRevenue: round2(num(r.pt_revenue)),
    newMembers,
    ptOnJoinPct: pct(num(r.pt_on_join), newMembers),

    bookCount: book,
    bookPct: pct(book, newMembers),
    bookGoal,
    bookDiff: bookGoal === null ? null : book - bookGoal,

    bookOnJoinCount: num(r.book_on_join),
    bookOnJoinPct: pct(num(r.book_on_join), newMembers),

    setToDate,
    setInclFuture: num(r.set_incl_future),

    // Of the appointments that were meant to happen, the ones that passed with
    // nobody recording an outcome. Set-to-date is the right denominator: it is
    // the same population — scheduled from the window start, up to today — and
    // pending is the slice of it still waiting on a form.
    //
    // NOT part of Show or Close. A pending Day One is unknown, not a no-show, so
    // folding it into either rate would invent an outcome nobody recorded.
    pendingCount: num(r.pending_count),
    pendingPct: pct(num(r.pending_count), setToDate),

    showCount: show,
    showPct: pct(show, setToDate),
    showGoal,
    showDiff: showGoal === null ? null : show - showGoal,

    closeCount: close,
    closePct: pct(close, show),
    closeGoal,
    closeDiff: closeGoal === null ? null : close - closeGoal,

    newEftDraft: newEft,
    cancelledEftDraft: cancelledEft,
    netEftDraft: round2(newEft - cancelledEft),
    newPifRevenue: round2(num(r.new_pif_revenue)),
    pifOnJoinPct: pct(num(r.pif_on_join), newMembers),
  }
}

/**
 * @param rows  from analytics_pt_scorecard()
 * @param opts  { goals: {book, show, close}, clubNameFor }
 */
function buildScorecard(rows, opts = {}) {
  const goals = normalizeGoals(opts.goals)
  const clubNameFor = opts.clubNameFor || ((n) => n)

  const clubs = (rows || []).map(r => buildRow(r, goals, clubNameFor))

  // The Overall line is recomputed from pooled counts, never averaged from the
  // club rows: averaging six percentages weights a 9-member club the same as a
  // 97-member one.
  const pooled = (rows || []).reduce((a, r) => {
    a.new_members += num(r.new_members)
    a.pt_on_join += num(r.pt_on_join)
    a.pif_on_join += num(r.pif_on_join)
    a.book_count += num(r.book_count)
    a.book_on_join += num(r.book_on_join)
    a.set_to_date += num(r.set_to_date)
    a.set_incl_future += num(r.set_incl_future)
    a.show_count += num(r.show_count)
    a.close_count += num(r.close_count)
    a.pending_count += num(r.pending_count)
    a.pt_revenue += num(r.pt_revenue)
    a.new_eft_draft += num(r.new_eft_draft)
    a.cancelled_eft_draft += num(r.cancelled_eft_draft)
    a.new_pif_revenue += num(r.new_pif_revenue)
    return a
  }, {
    club_number: null, new_members: 0, pt_on_join: 0, pif_on_join: 0,
    book_count: 0, book_on_join: 0, set_to_date: 0, set_incl_future: 0,
    show_count: 0, close_count: 0, pending_count: 0, pt_revenue: 0,
    new_eft_draft: 0, cancelled_eft_draft: 0, new_pif_revenue: 0,
  })

  const overall = buildRow(pooled, goals, () => 'Overall')

  // Sorted by size so the biggest club leads, with Overall pinned on top by
  // the UI rather than mixed into the list.
  clubs.sort((a, b) => b.newMembers - a.newMembers)

  return { overall, clubs, goals }
}

module.exports = {
  buildScorecard, buildRow, normalizeGoals, goalCount, pct,
  GOAL_KEYS, DEFAULT_GOAL_PCT,
}
