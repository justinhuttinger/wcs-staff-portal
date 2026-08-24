'use strict'

// Validation for the public intake site (program.westcoaststrength.com).
// Unlike the GHL webhook, this payload comes straight off a public form, so
// every field is treated as hostile: types are coerced, lengths are capped
// (free text lands in a Claude prompt), and unknown keys are dropped.

const MAX_TEXT = 1000        // any single free-text answer
const MAX_SHORT = 120        // names, emails, single-word-ish answers

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function text(v, max = MAX_TEXT) {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join(', ') : String(v)
  return s.trim().slice(0, max)
}

function bool(v) {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'true' || s === 'yes' || s === '1' || s === 'on'
}

// A screening answer is stored as the words the prompt builder expects.
function yesNo(v) {
  if (v == null || v === '') return 'No'
  const s = text(v, MAX_SHORT)
  return /^(yes|true|1)$/i.test(s) ? 'Yes' : (/^(no|false|0)$/i.test(s) ? 'No' : s)
}

function intInRange(v, { min, max, fallback }) {
  const n = parseInt(String(v ?? '').replace(/[^0-9-]/g, ''), 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Map the site's payload onto the exact formData shape generateProgram expects,
// so both entry points feed the generator identically.
function normalizeIntake(intake = {}, trainerName = '') {
  const i = intake || {}
  const out = {
    trainerName: text(trainerName, MAX_SHORT),
    programGoal: text(i.programGoal) || 'general fitness',
    duration: String(intInRange(i.duration, { min: 1, max: 52, fallback: 8 })),
    daysPerWeek: String(intInRange(i.daysPerWeek, { min: 1, max: 7, fallback: 4 })),
    experienceLevel: (text(i.experienceLevel, MAX_SHORT) || 'intermediate').toLowerCase(),
    equipment: text(i.equipment, MAX_SHORT) || 'full gym',

    weight: text(i.weight, MAX_SHORT),
    height: text(i.height, MAX_SHORT),
    bodyFat: text(i.bodyFat, MAX_SHORT).replace('%', ''),
    bmr: text(i.bmr, MAX_SHORT),

    neckLimitation: bool(i.neckLimitation),
    shoulderLimitation: bool(i.shoulderLimitation),
    elbowWristLimitation: bool(i.elbowWristLimitation),
    lowerBackLimitation: bool(i.lowerBackLimitation),
    hipLimitation: bool(i.hipLimitation),
    kneeLimitation: bool(i.kneeLimitation),
    ankleLimitation: bool(i.ankleLimitation),
    otherLimitations: text(i.otherLimitations),

    interestedIn: text(i.interestedIn),
    interestedInPT: text(i.interestedInPT, MAX_SHORT),
    preferredCoach: text(i.preferredCoach, MAX_SHORT),
    fitnessGoals: text(i.fitnessGoals),

    heartCondition: yesNo(i.heartCondition),
    chestPain: yesNo(i.chestPain),
    boneJointProblem: yesNo(i.boneJointProblem),
    bloodPressureMedication: yesNo(i.bloodPressureMedication),
    medicalSupervisionNeeded: yesNo(i.medicalSupervisionNeeded),

    currentWorkoutRoutine: text(i.currentWorkoutRoutine),
    followsDietPlan: text(i.followsDietPlan, MAX_SHORT),
    biggestObstacles: text(i.biggestObstacles),
    wouldHelpMost: text(i.wouldHelpMost),

    gender: text(i.gender, MAX_SHORT),
    trainerNotes: text(i.trainerNotes),
  }
  // Day focus overrides only matter for the days actually being trained.
  const days = parseInt(out.daysPerWeek, 10)
  for (let d = 1; d <= 7; d++) {
    out[`day${d}Focus`] = d <= days ? text(i[`day${d}Focus`], MAX_SHORT) : ''
  }
  return out
}

function normalizeClient(client = {}) {
  const c = client || {}
  return {
    firstName: text(c.firstName, MAX_SHORT),
    lastName: text(c.lastName, MAX_SHORT),
    email: text(c.email, MAX_SHORT).toLowerCase(),
    phone: text(c.phone, MAX_SHORT),
  }
}

// Returns { errors: [...] } when the payload can't produce a program.
function validateSubmission(body = {}) {
  const errors = []
  const client = normalizeClient(body.client)
  const trainerName = text(body.trainerName, MAX_SHORT)

  if (!client.firstName) errors.push('Client first name is required')
  // The finished program is emailed to the client, so this is not optional.
  if (!client.email) errors.push('Client email is required')
  else if (!EMAIL_RE.test(client.email)) errors.push('Client email is not a valid address')
  if (!trainerName) errors.push('Trainer name is required')
  if (!String(body.slug || '').trim()) errors.push('Location is required')

  return { errors, client, trainerName, formData: normalizeIntake(body.intake, trainerName) }
}

module.exports = { validateSubmission, normalizeIntake, normalizeClient, MAX_TEXT, MAX_SHORT }
