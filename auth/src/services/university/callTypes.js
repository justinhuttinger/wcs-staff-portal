// WCS University — call types.
//
// A call_type is the *situation* the trainee is calling into. It changes the
// lead's mindset, the rep's goal, and — crucially — how the call is graded.
// Persona attributes (name, objection, lead_source, difficulty) are orthogonal
// "color"; call_type is the backbone. One base Retell agent plays all of them:
// the scaffold computes `situation` + `your_goal` here and injects them as
// dynamic variables, so we never need a separate agent per type.
//
// Each call type defines:
//   label            human label
//   milestoneKey     competency milestone in the ledger (roleplay_<type>)
//   repGoal          what the trainee is trying to accomplish (for the grader)
//   situation(d)     the lead's situation/mindset, scaled by difficulty
//   dimensions       scored rubric dimensions (0-100 each)
//   objectionDim     which dimension feeds the cross-cutting objection_handling
//                    milestone (null if this type has no objection analog)

const DIFFICULTY_NOTE = {
  easy: 'You are warm and mostly cooperative.',
  medium: 'You are interested but guarded; make the rep work a bit.',
  hard: 'You are distracted and resistant; only open up if the rep genuinely earns it.',
}

function diffNote(difficulty) {
  return DIFFICULTY_NOTE[difficulty] || DIFFICULTY_NOTE.medium
}

const CALL_TYPES = {
  cold_lead: {
    label: 'Cold lead (sales)',
    milestoneKey: 'roleplay_cold_lead',
    repGoal:
      'Build rapport, uncover the prospect\'s real motivation, handle their objection, and book a tour / Day One.',
    situation: d =>
      `You responded to an ad for West Coast Strength and a sales rep is calling you. You have not visited yet. ${diffNote(d)}`,
    dimensions: ['rapport', 'discovery', 'objection_handling', 'asked_for_commitment', 'progression'],
    objectionDim: 'objection_handling',
  },

  mid_trial: {
    label: 'Mid-trial check-in',
    milestoneKey: 'roleplay_mid_trial',
    repGoal:
      'Re-engage them warmly, surface what is getting in the way, reinforce the value, and book their next session.',
    situation: d =>
      `You started a trial at West Coast Strength about a week ago and have only been in once or twice. A coach is checking in. You are busy and a little intimidated; you will keep coming only if it feels worth it and someone makes it easy. ${diffNote(d)}`,
    dimensions: ['rapport', 'surfaced_friction', 'value_reinforcement', 'booked_next_session', 'tone'],
    objectionDim: 'surfaced_friction',
  },

  expired_trial: {
    label: 'Expired-trial winback',
    milestoneKey: 'roleplay_winback',
    repGoal:
      'Reconnect without guilt-tripping, acknowledge the drop-off, re-sell the value, overcome the "I fell off" resistance, and get them back in the door.',
    situation: d =>
      `Your trial at West Coast Strength lapsed a few weeks ago and you stopped coming. A coach is reaching out. You feel a little guilty you fell off and you are skeptical you will stick with it this time; you need a real reason and an easy path back. ${diffNote(d)}`,
    dimensions: ['reconnection', 'acknowledged_lapse', 're_sold_value', 'overcame_resistance', 'asked_for_return'],
    objectionDim: 'overcame_resistance',
  },

  new_member: {
    label: 'New member onboarding',
    milestoneKey: 'roleplay_new_member',
    repGoal:
      'Welcome them, set up their Day One (InBody, coached workout, custom program), build the habit, and position personal training where it fits.',
    situation: d =>
      `You just joined West Coast Strength. A coach is calling to get you started. You are motivated but unsure what to do first; you want a clear next step and to feel like they have a plan for you. ${diffNote(d)}`,
    dimensions: ['welcome_rapport', 'day_one_setup', 'habit_building', 'pt_positioning', 'clear_next_step'],
    objectionDim: null,
  },
}

const DEFAULT_CALL_TYPE = 'cold_lead'

function getCallType(key) {
  return CALL_TYPES[key] || CALL_TYPES[DEFAULT_CALL_TYPE]
}

function milestoneKeyFor(callTypeKey) {
  return getCallType(callTypeKey).milestoneKey
}

module.exports = { CALL_TYPES, DEFAULT_CALL_TYPE, getCallType, milestoneKeyFor, diffNote }
