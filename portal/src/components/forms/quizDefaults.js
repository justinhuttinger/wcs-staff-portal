// Mirrors auth/src/services/quizSchema.js DEFAULT_QUIZ_SETTINGS + validators.
export const QUIZ_DEFAULTS = {
  contact_step: {
    heading: 'Where should we send your results?', subtext: '',
    require_first_name: true, require_last_name: false, require_phone: true,
  },
  thank_you: { heading: "You're all set!", message: '', redirect_url: '' },
  tracking: { meta_pixel_id: '', gtm_id: '' },
}

export const PIXEL_RE = /^\d{6,20}$/
export const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/
export const MAX_WEBHOOK_ATTEMPTS = 5

export function quizSettingsFrom(s) {
  const src = s && typeof s === 'object' ? s : {}
  return {
    contact_step: { ...QUIZ_DEFAULTS.contact_step, ...(src.contact_step || {}) },
    thank_you: { ...QUIZ_DEFAULTS.thank_you, ...(src.thank_you || {}) },
    tracking: { ...QUIZ_DEFAULTS.tracking, ...(src.tracking || {}) },
  }
}

export function webhookBadge(sub) {
  const n = sub?.webhook_attempts || 0
  switch (sub?.webhook_status) {
    case 'sent': return { label: 'Sent to GHL', tone: 'green' }
    case 'failed': return n >= MAX_WEBHOOK_ATTEMPTS
      ? { label: 'Failed', tone: 'red' }
      : { label: `Retrying (${n}/${MAX_WEBHOOK_ATTEMPTS})`, tone: 'amber' }
    case 'pending': return { label: 'Sending', tone: 'gray' }
    default: return { label: 'No webhook', tone: 'gray' }
  }
}
