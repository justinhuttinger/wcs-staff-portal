import { useEffect, useState } from 'react'
import { getMembershipReport, getSpeedToLead, getCancelsReport, getComplianceSummary, getDailySnapshot, getAppSettings } from '../../lib/api'
import { formatMinutes } from '../../lib/kpiMath'
import { LOCATION_NAMES } from '../../config/locations'
import ReportInfoButton from '../ReportInfoButton'
import DesktopLoading from '../DesktopLoading'

// Spotlight (experimental): how did ONE day go at ONE club — a wins/losses
// scoreboard. Composes the existing report endpoints with start=end=the day
// (no new backend): membership (sales/trials/day-ones/VIPs), speed-to-lead
// (business-hours median), compliance summary (Operandio API), cancels (C2S),
// and the daily-snapshot composite (day-one completions, tours, revenue).
// Verdicts compare against the per-club KPI goals from Admin → KPI Goals.

const CLUB_SLUGS = LOCATION_NAMES.map(n => n.toLowerCase())
const CLUB_LABEL = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))

const SPOTLIGHT_INFO = {
  title: 'Spotlight',
  sections: [
    {
      heading: 'What this is',
      body: 'A single-day scoreboard for one club: every number is what happened ON that day only, judged against the same per-club goals as the KPI report. Wins hit the goal, losses missed it.',
    },
    {
      heading: 'Reading single-day numbers',
      body: 'One day is a small sample. A 0% with one member signed is not a trend, so each percentage shows its raw counts and a verdict only appears when there was anything to judge (no cancels means no Click2Save verdict, for example).',
    },
  ],
  notes: [
    'Goals come from Admin → KPI Goals. Metrics without a goal are shown for context without a verdict.',
    'Revenue and Day One completions come from overnight data, so today is always incomplete — yesterday is the freshest full day.',
  ],
}

function todayPacific() {
  const pt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  return `${pt.getFullYear()}-${String(pt.getMonth() + 1).padStart(2, '0')}-${String(pt.getDate()).padStart(2, '0')}`
}
function yesterdayPacific() {
  const d = new Date(todayPacific() + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
}
function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pctOf = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null)

function goalFor(goals, key, slug) {
  const raw = goals[`kpi_goal_${key}_${slug}`]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

// verdict: 'win' | 'loss' | null (no goal set, or nothing happened to judge)
function judge(value, goal, lowerIsBetter = false) {
  if (value == null || goal == null) return null
  return (lowerIsBetter ? value <= goal : value >= goal) ? 'win' : 'loss'
}

function VerdictBadge({ verdict }) {
  if (verdict === 'win') return <span className="text-xs font-bold px-2 py-1 rounded-md bg-green-100 text-green-700">WIN</span>
  if (verdict === 'loss') return <span className="text-xs font-bold px-2 py-1 rounded-md bg-red-100 text-red-600">LOSS</span>
  return <span className="text-xs font-semibold px-2 py-1 rounded-md bg-bg text-text-muted">—</span>
}

// One scoreboard row: metric name + detail, day value, goal, verdict.
function ScoreRow({ label, detail, value, goal, verdict, unavailable }) {
  return (
    <li className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm sm:text-base font-bold text-text-primary">{label}</p>
        {detail && <p className="text-xs text-text-muted mt-0.5">{detail}</p>}
      </div>
      <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0">
        <div className="text-right">
          <p className={`text-lg sm:text-xl font-bold leading-none ${unavailable ? 'text-text-muted' : 'text-text-primary'}`}>
            {unavailable ? '—' : value}
          </p>
          {unavailable && <p className="text-[10px] text-amber-600 mt-1 uppercase tracking-wide">Unavailable</p>}
        </div>
        <div className="text-right w-16">
          <p className="text-sm font-semibold text-text-muted leading-none">{goal ?? '—'}</p>
          <p className="text-[10px] text-text-muted mt-1 uppercase tracking-wide">Goal</p>
        </div>
        <div className="w-14 text-right">
          <VerdictBadge verdict={unavailable ? null : verdict} />
        </div>
      </div>
    </li>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

export default function SpotlightReport() {
  const [club, setClub] = useState(CLUB_SLUGS[0])
  const [date, setDate] = useState(yesterdayPacific)
  const [goals, setGoals] = useState({})
  const [data, setData] = useState(null) // { membership, speed, compliance, cancels, snapshot }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAppSettings('kpi_').then(m => setGoals(m || {})).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const range = { start_date: date, end_date: date, location_slug: club }
    Promise.all([
      getMembershipReport(range).catch(() => null),
      getSpeedToLead(range).catch(() => null),
      getComplianceSummary(range).catch(() => null),
      getCancelsReport(range).catch(() => null),
      getDailySnapshot({ date, location: club }).catch(() => null),
    ]).then(([membership, speed, compliance, cancels, snapshot]) => {
      if (cancelled) return
      setData({ membership, speed, compliance, cancels, snapshot })
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [club, date])

  if (loading || !data) return <DesktopLoading />

  const { membership, speed, compliance, cancels, snapshot } = data
  const isPast = snapshot?.mode === 'past'

  // --- Derive the day's numbers -------------------------------------------
  const sold = membership?.total_memberships ?? null
  const trialsStarted = membership?.trial_conversion?.trial_started ?? null
  const dayOnesBooked = membership?.total_day_one_booked ?? null
  const vips = membership?.total_vips ?? null

  const dayOneScheduled = snapshot?.day_one?.scheduled ?? null
  const dayOneCompleted = isPast ? (snapshot?.day_one?.completed ?? null) : null
  const dayOneNoShow = isPast ? (snapshot?.day_one?.no_show ?? null) : null

  const dayonePct = pctOf(dayOnesBooked || 0, sold || 0)
  const vipPct = pctOf(vips || 0, sold || 0)
  const speedMedian = speed?.contacted_count ? speed.business_median_minutes : null
  const opsDecided = compliance?.decided ?? 0
  const opsSteps = compliance?.task?.steps_total ?? 0
  const opsPct = opsSteps > 0 ? pctOf(compliance.task.steps_done || 0, opsSteps) : null
  const cancelled = cancels?.c2s_utilization?.cancelled_members ?? 0
  const viaC2s = cancels?.c2s_utilization?.via_c2s ?? 0
  const c2sPct = cancelled > 0 ? Math.min(100, pctOf(viaC2s, cancelled)) : null
  const dayOneCompletionPct = isPast && dayOneScheduled > 0 ? pctOf(dayOneCompleted || 0, dayOneScheduled) : null

  const gDayone = goalFor(goals, 'dayone', club)
  const gVip = goalFor(goals, 'vip', club)
  const gSpeed = goalFor(goals, 'speed', club)
  const gOps = goalFor(goals, 'ops', club)
  const gC2s = goalFor(goals, 'c2s', club)

  // Rows with a goal produce the win/loss tally; the rest are context.
  const rows = [
    {
      label: 'Day One Attachment', verdict: judge(dayonePct, gDayone),
      detail: sold > 0 ? `${dayOnesBooked} of ${sold} new members booked a Day One` : 'No memberships sold this day',
      value: dayonePct == null ? 'n/a' : `${dayonePct}%`, goal: gDayone == null ? null : `${gDayone}%`,
      unavailable: membership == null,
    },
    {
      label: 'VIP Collection', verdict: judge(vipPct, gVip),
      detail: sold > 0 ? `${vips} of ${sold} new members with a VIP` : 'No memberships sold this day',
      value: vipPct == null ? 'n/a' : `${vipPct}%`, goal: gVip == null ? null : `${gVip}%`,
      unavailable: membership == null,
    },
    {
      label: 'Speed to Lead', verdict: judge(speedMedian, gSpeed, true),
      detail: speed?.contacted_count
        ? `${speed.contacted_count} lead${speed.contacted_count === 1 ? '' : 's'} contacted (business-hours clock)`
        : 'No new leads contacted this day',
      value: speedMedian == null ? 'n/a' : formatMinutes(speedMedian), goal: gSpeed == null ? null : formatMinutes(gSpeed),
      unavailable: speed == null,
    },
    {
      label: 'Operational Compliance', verdict: judge(opsPct, gOps),
      detail: opsSteps > 0
        ? `${compliance.task.steps_done} of ${opsSteps} tasks completed across ${opsDecided} due Operandio job${opsDecided === 1 ? '' : 's'}`
        : 'No Operandio jobs due this day',
      value: opsPct == null ? 'n/a' : `${opsPct}%`, goal: gOps == null ? null : `${gOps}%`,
      unavailable: compliance == null,
    },
    {
      label: 'Click2Save Utilization', verdict: judge(c2sPct, gC2s),
      detail: cancelled > 0 ? `${viaC2s} of ${cancelled} cancels went through Click2Save` : 'No cancels took effect this day',
      value: c2sPct == null ? 'n/a' : `${c2sPct}%`, goal: gC2s == null ? null : `${gC2s}%`,
      unavailable: cancels == null,
    },
    {
      label: 'Day One Completion',
      // No configured goal for this one — completing every booked Day One is
      // the implicit standard, so 100% is the bar when any were scheduled.
      verdict: isPast && dayOneScheduled > 0 ? (dayOneCompletionPct >= 100 ? 'win' : 'loss') : null,
      detail: !isPast
        ? 'Completions are only known for past days'
        : dayOneScheduled > 0
          ? `${dayOneCompleted} of ${dayOneScheduled} marked complete${dayOneNoShow ? `, ${dayOneNoShow} no-show/cancel` : ''}`
          : 'No Day Ones on the schedule this day',
      value: dayOneCompletionPct == null ? 'n/a' : `${dayOneCompletionPct}%`, goal: isPast && dayOneScheduled > 0 ? '100%' : null,
      unavailable: snapshot == null,
    },
  ]

  const wins = rows.filter(r => !r.unavailable && r.verdict === 'win').length
  const losses = rows.filter(r => !r.unavailable && r.verdict === 'loss').length

  return (
    <div className="space-y-4">
      {/* Controls: one club at a time (goals are per club) + the day */}
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {CLUB_SLUGS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setClub(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                club === s ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {CLUB_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => setDate(yesterdayPacific())}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              date === yesterdayPacific() ? 'bg-text-primary text-white border-text-primary' : 'bg-bg text-text-muted border-border hover:text-text-primary'
            }`}
          >
            Yesterday
          </button>
          <input
            type="date"
            value={date}
            max={todayPacific()}
            onChange={e => e.target.value && setDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
          />
        </div>
      </div>

      {/* Hero: the day's verdict at a glance */}
      <div className="bg-surface rounded-xl border border-border p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-text-primary">{CLUB_LABEL[club]} — {fmtDayLabel(date)}</h2>
            <ReportInfoButton info={SPOTLIGHT_INFO} portal />
          </div>
          <p className="text-xs text-text-muted mt-1">
            {!isPast ? 'Today is still in progress — completions and revenue land overnight.' : 'Judged against this club\'s KPI goals.'}
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600 leading-none">{wins}</p>
            <p className="text-[10px] text-text-muted mt-1 uppercase tracking-wide">Wins</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-red-500 leading-none">{losses}</p>
            <p className="text-[10px] text-text-muted mt-1 uppercase tracking-wide">Losses</p>
          </div>
        </div>
      </div>

      {/* The day's raw production numbers — context, not judged */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Memberships Sold" value={membership == null ? '—' : (sold ?? 0)} />
        <StatCard label="Trials Started" value={membership == null ? '—' : (trialsStarted ?? 0)}
          sub={membership != null && sold != null ? `vs ${sold} sold` : null} />
        <StatCard label="Tours" value={snapshot == null ? '—' : (snapshot?.tours?.scheduled ?? 0)}
          sub={isPast && snapshot?.tours?.no_show ? `${snapshot.tours.no_show} no-show/cancel` : null} />
        <StatCard label="Revenue" value={isPast ? fmtMoney(snapshot?.revenue?.total) : '—'}
          sub={isPast ? null : 'Uploads overnight'} />
      </div>

      {/* Scoreboard */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <ul className="divide-y divide-border">
          {rows.map(r => <ScoreRow key={r.label} {...r} />)}
        </ul>
      </div>
    </div>
  )
}
