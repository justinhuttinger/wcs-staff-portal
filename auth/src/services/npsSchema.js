// Pure validation for NPS survey question schemas and submitted answers.
// No I/O: the caller supplies the metric vocabulary. Mirrors the shape of
// services/formsSchema.js.

const DISPLAY_TYPES = ['header', 'description'];
const SCORE_TYPES = ['rating', 'nps'];
const INPUT_TYPES = ['rating', 'nps', 'textarea', 'short_text', 'select'];
const QUESTION_TYPES = [...INPUT_TYPES, ...DISPLAY_TYPES];

const ID_RE = /^q_[a-z0-9_]{1,20}$/i;
const MAX_TEXT = 2000;

// An nps question is the standard 0..10 recommendation scale. It is fixed here
// rather than read from the schema so one survey cannot quietly redefine the
// scale and make its scores incomparable with every other survey's.
const NPS_MIN = 0;
const NPS_MAX = 10;

function ratingBounds(field) {
  if (field.type === 'nps') return { min: NPS_MIN, max: NPS_MAX };
  return { min: Number(field.min), max: Number(field.max) };
}

function validateSchema(schema, { metricKeys = [] } = {}) {
  if (!Array.isArray(schema)) return { ok: false, error: 'schema must be an array' };
  const allowed = new Set(metricKeys);
  const seen = new Set();

  for (const f of schema) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'question must be an object' };
    if (typeof f.id !== 'string' || !ID_RE.test(f.id)) {
      return { ok: false, error: `invalid question id: ${f.id}` };
    }
    if (seen.has(f.id)) return { ok: false, error: `duplicate question id: ${f.id}` };
    seen.add(f.id);
    if (!QUESTION_TYPES.includes(f.type)) return { ok: false, error: `invalid question type: ${f.type}` };

    if (!DISPLAY_TYPES.includes(f.type) && (typeof f.label !== 'string' || !f.label.trim())) {
      return { ok: false, error: `question ${f.id} needs a label` };
    }
    if (f.type === 'select') {
      const opts = f.options;
      if (!Array.isArray(opts) || opts.length === 0 || opts.some(o => typeof o !== 'string' || !o.trim())) {
        return { ok: false, error: `question ${f.id} needs at least one option` };
      }
    }
    if (f.type === 'rating') {
      const min = Number(f.min);
      const max = Number(f.max);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) {
        return { ok: false, error: `question ${f.id} needs integer min < max` };
      }
    }
    if (SCORE_TYPES.includes(f.type)) {
      // The controlled vocabulary is the point. See nps_metrics.
      if (typeof f.metric_key !== 'string' || !allowed.has(f.metric_key)) {
        return { ok: false, error: `question ${f.id} has an unknown metric_key: ${f.metric_key}` };
      }
    }
  }
  return { ok: true };
}

function isBlank(v) {
  return v == null || (typeof v === 'string' && !v.trim());
}

function validateSubmission(schema, answers) {
  const errors = {};
  const cleaned = {};
  const scores = [];
  const body = answers && typeof answers === 'object' ? answers : {};
  const inputs = (schema || []).filter(f => INPUT_TYPES.includes(f.type));
  const known = new Set(inputs.map(f => f.id));

  for (const key of Object.keys(body)) {
    if (!known.has(key)) errors[key] = 'Unknown question';
  }

  for (const f of inputs) {
    const raw = body[f.id];
    if (isBlank(raw)) {
      if (f.required) errors[f.id] = 'This question is required';
      continue;
    }

    if (SCORE_TYPES.includes(f.type)) {
      const n = Number(raw);
      const { min, max } = ratingBounds(f);
      if (!Number.isInteger(n) || n < min || n > max) {
        errors[f.id] = `Pick a number from ${min} to ${max}`;
        continue;
      }
      cleaned[f.id] = n;
      scores.push({ metric_key: f.metric_key, score: n });
      continue;
    }

    if (f.type === 'select') {
      const s = String(raw);
      if (!(f.options || []).includes(s)) {
        errors[f.id] = 'Pick one of the listed options';
        continue;
      }
      cleaned[f.id] = s;
      continue;
    }

    const text = String(raw).trim();
    if (text.length > MAX_TEXT) {
      errors[f.id] = `Keep it under ${MAX_TEXT} characters`;
      continue;
    }
    cleaned[f.id] = text;
  }

  return { ok: Object.keys(errors).length === 0, errors, cleaned, scores };
}

module.exports = {
  validateSchema, validateSubmission,
  QUESTION_TYPES, INPUT_TYPES, SCORE_TYPES, DISPLAY_TYPES,
};
