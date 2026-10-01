// Check-in celebration settings: which lifetime milestones and time-based
// rules earn a member a "celebrate" ABC alert (and the WCS ABC party cue).
//
// Stored as JSON text in app_config key `checkin_celebration_settings`,
// edited in Portal Admin -> Check-in Celebrations, read nightly by ghl-sync's
// celebration job.
//
// KEEP IN SYNC: this file exists twice, byte-identical, at
//   auth/src/lib/celebrationSettings.js
//   ghl-sync/src/abc/celebrationSettings.js
// (separate Render deployables can't share code). A test in auth fails if
// the copies drift.

const CONFIG_KEY = 'checkin_celebration_settings'
const RULE_TYPES = ['rolling', 'new_member', 'calendar_month']
const MAX_TEXT = 22 // ABC alert text limit
const ABC_CHARS = /^[A-Z0-9 ,_!%+\-@^]+$/ // and never "/"
const MAX_RULES = 20

const DEFAULT_SETTINGS = Object.freeze({
  lifetime: Object.freeze({ enabled: true, milestones: Object.freeze([10, 25, 50, 100, 150, 200, 250, 300]), repeatEvery: 100 }),
  rules: Object.freeze([]),
})

function fit(text) {
  if (text.length <= MAX_TEXT && ABC_CHARS.test(text)) return text
  const bare = text.replace(/!$/, '')
  return bare.length <= MAX_TEXT && ABC_CHARS.test(bare) ? bare : null
}

// 1ST, 2ND, 3RD, 4TH ... 11TH-13TH, 21ST, 22ND, 101ST.
function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}TH`
  return `${n}${({ 1: 'ST', 2: 'ND', 3: 'RD' })[n % 10] || 'TH'}`
}

function lifetimeText(n) {
  return fit(`CELEBRATE ${ordinal(n)} VISIT!`)
}

function ruleText(rule) {
  const v = rule.visits
  if (rule.type === 'rolling') return fit(`${v} VISITS IN ${rule.days} DAYS!`)
  if (rule.type === 'new_member') return fit(`${v} IN FIRST ${rule.days} DAYS!`)
  if (rule.type === 'calendar_month') return fit(`${v} VISITS THIS MONTH!`)
  return null
}

function ruleLabel(rule) {
  const v = rule.visits
  if (rule.type === 'rolling') return `${v} visits in ${rule.days} days`
  if (rule.type === 'new_member') return `${v} visits in first ${rule.days} days`
  if (rule.type === 'calendar_month') return `${v} visits this month`
  return ''
}

function ruleKey(rule) {
  return `${rule.type}:${rule.visits}:${rule.type === 'calendar_month' ? 0 : rule.days}`
}

function isLifetimeMilestone(n, lifetime) {
  if (!lifetime || !lifetime.enabled || !Number.isInteger(n) || n < 1) return false
  const list = lifetime.milestones || []
  if (list.includes(n)) return true
  const top = list.length ? Math.max(...list) : 0
  const every = lifetime.repeatEvery || 0
  return every > 0 && n > top && (n - top) % every === 0
}

function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v)
  return NaN
}

function validateLifetime(input, errors) {
  const src = input || {}
  const raw = Array.isArray(src.milestones) ? src.milestones : DEFAULT_SETTINGS.lifetime.milestones
  const milestones = []
  for (const m of raw) {
    const n = toInt(m)
    if (!Number.isInteger(n) || n < 1 || n > 100000) { errors.push(`Milestone "${m}" must be a whole number from 1 to 100000`); continue }
    if (!lifetimeText(n)) { errors.push(`Milestone ${n} is too long for an ABC alert`); continue }
    if (!milestones.includes(n)) milestones.push(n)
  }
  milestones.sort((a, b) => a - b)
  const every = src.repeatEvery === undefined || src.repeatEvery === null || src.repeatEvery === '' ? 0 : toInt(src.repeatEvery)
  if (!Number.isInteger(every) || every < 0 || every > 10000) errors.push('"Then every" must be 0 (off) or a whole number up to 10000')
  return { enabled: src.enabled !== false, milestones, repeatEvery: Number.isInteger(every) && every >= 0 ? every : 0 }
}

function validateRule(input, index) {
  const r = input || {}
  const where = `Rule ${index + 1}`
  if (!RULE_TYPES.includes(r.type)) return { error: `${where}: pick a rule type` }
  const visits = toInt(r.visits)
  if (!Number.isInteger(visits) || visits < 2 || visits > 1000) return { error: `${where}: visits must be 2 to 1000` }
  let days = null
  if (r.type !== 'calendar_month') {
    days = toInt(r.days)
    if (!Number.isInteger(days) || days < 1 || days > 365) return { error: `${where}: days must be 1 to 365` }
  }
  const rule = {
    id: typeof r.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(r.id) ? r.id : 'r' + Math.random().toString(36).slice(2, 10),
    type: r.type, visits, days, enabled: r.enabled !== false,
  }
  if (!ruleText(rule)) return { error: `${where}: too long for an ABC alert` }
  return { rule }
}

// For saving from the admin page: every problem reported, nothing silently
// dropped. Returns { settings, errors }.
function validateSettings(input) {
  const errors = []
  const src = input || {}
  const lifetime = validateLifetime(src.lifetime, errors)
  const rawRules = Array.isArray(src.rules) ? src.rules : []
  if (rawRules.length > MAX_RULES) errors.push(`At most ${MAX_RULES} rules`)
  const rules = []
  const seen = new Set()
  rawRules.slice(0, MAX_RULES).forEach((r, i) => {
    const { rule, error } = validateRule(r, i)
    if (error) { errors.push(error); return }
    if (rule.enabled) {
      const k = ruleKey(rule)
      if (seen.has(k)) { errors.push(`Rule ${i + 1}: same as another enabled rule`); return }
      seen.add(k)
    }
    rules.push(rule)
  })
  return { settings: { lifetime, rules }, errors }
}

// For the nightly job: never throws. Unreadable settings fall back to the
// defaults; individually bad rules are dropped so good ones still run.
function parseSettings(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { obj = null }
  }
  if (!obj || typeof obj !== 'object') return DEFAULT_SETTINGS
  const lifetimeErrors = []
  const lifetime = validateLifetime(obj.lifetime, lifetimeErrors)
  const rules = []
  const seen = new Set()
  ;(Array.isArray(obj.rules) ? obj.rules : []).slice(0, MAX_RULES).forEach((r, i) => {
    const { rule } = validateRule(r, i)
    if (!rule) return
    const k = ruleKey(rule)
    if (rule.enabled && seen.has(k)) return
    if (rule.enabled) seen.add(k)
    rules.push(rule)
  })
  return {
    lifetime: lifetimeErrors.length ? DEFAULT_SETTINGS.lifetime : lifetime,
    rules,
  }
}

module.exports = {
  CONFIG_KEY, RULE_TYPES, MAX_TEXT, MAX_RULES, DEFAULT_SETTINGS,
  ordinal, lifetimeText, ruleText, ruleLabel, ruleKey, isLifetimeMilestone,
  validateSettings, parseSettings,
}
