const { Router } = require('express');
const authenticate = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { testFire } = require('../services/npsTestFire');
const npsAdmin = require('../services/npsAdmin');
const { loadSentLog } = require('../services/npsSentLog');
const auditLog = require('../services/auditLog');

// Admin-only NPS tooling. The public render/submit endpoints live in
// routes/publicNps.js and are deliberately unauthenticated.
const router = Router();
router.use(authenticate);
router.use(requireRole('admin'));

// POST /nps/test-fire  { slug, member_id, force }
//
// Rails off by design: with force this skips the cooldown and writes a real
// GHL field + tag, so a real email really sends. That is the only way to
// verify the GHL workflow itself, which no unit test reaches.
router.post('/test-fire', async (req, res) => {
  const { slug, member_id: memberId, force = true } = req.body || {};
  if (!slug || !memberId) {
    return res.status(400).json({ error: 'slug and member_id are required' });
  }

  try {
    const result = await testFire({ slug, memberId, force: Boolean(force) });

    auditLog.record(req.staff?.id, 'nps_test_fire', {
      target: memberId,
      metadata: { slug, force: Boolean(force), ok: result.ok, error: result.error || null },
      ip: req.ip,
    });

    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[nps] test-fire failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- member lookup ---------------------------------------------------------

// GET /nps/members/search?q=
//
// Backs the test-fire member picker. Deliberately its own endpoint rather than
// reusing /abc-scheduler/members/search: that one requires a club_number, and
// picking a test subject usually means finding yourself without first
// remembering which club you are on.
router.get('/members/search', async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json({ members: [] });

  try {
    const { supabaseAdmin } = require('../services/supabase');
    const pattern = `%${term}%`;
    const { data, error } = await supabaseAdmin
      .from('abc_members')
      .select('member_id, first_name, last_name, email, club_number, is_active')
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},member_id.ilike.${pattern}`)
      .limit(20);
    if (error) throw new Error(error.message);
    // A member with no email cannot be surveyed at all, so they are not
    // offered as a test subject.
    res.json({ members: (data || []).filter(m => m.email) });
  } catch (err) {
    console.error('[nps] member search failed:', err.message);
    res.status(500).json({ error: 'Failed to search members' });
  }
});

// --- sent log --------------------------------------------------------------

// GET /nps/sent?date=YYYY-MM-DD&survey=<id>
//
// What the nightly job did on one Pacific day. Includes dry-run and test rows,
// flagged, because during rollout those are the rows worth looking at.
router.get('/sent', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim()
      || new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    res.json(await loadSentLog({ date, surveyId: req.query.survey || null }));
  } catch (err) {
    console.error('[nps] sent log failed:', err.message);
    res.status(500).json({ error: 'Failed to load the sent log' });
  }
});

// --- surveys ---------------------------------------------------------------

router.get('/surveys', async (req, res) => {
  try {
    res.json({ surveys: await npsAdmin.listSurveys() });
  } catch (err) {
    console.error('[nps] list surveys failed:', err.message);
    res.status(500).json({ error: 'Failed to load surveys' });
  }
});

router.get('/surveys/:id', async (req, res) => {
  try {
    const survey = await npsAdmin.getSurvey({ id: req.params.id });
    if (!survey) return res.status(404).json({ error: 'Not found' });
    res.json({ survey, qr: await npsAdmin.listQrKeys({ surveyId: survey.id }) });
  } catch (err) {
    console.error('[nps] get survey failed:', err.message);
    res.status(500).json({ error: 'Failed to load survey' });
  }
});

router.post('/surveys', async (req, res) => {
  try {
    const result = await npsAdmin.createSurvey({ input: req.body || {} });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_survey_created', {
      target: result.survey.id,
      metadata: { slug: result.survey.slug, title: result.survey.title },
      ip: req.ip,
    });
    res.json({ survey: result.survey });
  } catch (err) {
    console.error('[nps] create survey failed:', err.message);
    res.status(500).json({ error: 'Failed to create survey' });
  }
});

router.patch('/surveys/:id', async (req, res) => {
  try {
    const { known_updated_at: knownUpdatedAt, ...patch } = req.body || {};
    const result = await npsAdmin.updateSurvey({ id: req.params.id, patch, knownUpdatedAt });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_survey_updated', {
      target: req.params.id,
      metadata: { fields: Object.keys(patch) },
      ip: req.ip,
    });
    res.json({ survey: result.survey });
  } catch (err) {
    console.error('[nps] update survey failed:', err.message);
    res.status(500).json({ error: 'Failed to update survey' });
  }
});

router.delete('/surveys/:id', async (req, res) => {
  try {
    const result = await npsAdmin.deleteSurvey({ id: req.params.id });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_survey_deleted', { target: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    console.error('[nps] delete survey failed:', err.message);
    res.status(500).json({ error: 'Failed to delete survey' });
  }
});

// --- QR keys ---------------------------------------------------------------

router.post('/surveys/:id/qr', async (req, res) => {
  try {
    const result = await npsAdmin.createQrKey({
      surveyId: req.params.id,
      clubNumber: (req.body || {}).club_number,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_qr_created', {
      target: req.params.id,
      metadata: { club_number: result.qr.club_number },
      ip: req.ip,
    });
    res.json({ qr: result.qr });
  } catch (err) {
    console.error('[nps] create qr failed:', err.message);
    res.status(500).json({ error: 'Failed to create QR key' });
  }
});

// Rotation is deliberate and audited: it invalidates whatever is already
// printed and hanging on a wall.
router.post('/qr/:id/rotate', async (req, res) => {
  try {
    const result = await npsAdmin.rotateQrKey({ id: req.params.id });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_qr_rotated', {
      target: req.params.id,
      metadata: { club_number: result.qr.club_number, new_id: result.qr.id },
      ip: req.ip,
    });
    res.json({ qr: result.qr });
  } catch (err) {
    console.error('[nps] rotate qr failed:', err.message);
    res.status(500).json({ error: 'Failed to rotate QR key' });
  }
});

// --- metrics ---------------------------------------------------------------

router.get('/metrics', async (req, res) => {
  try {
    res.json({ metrics: await npsAdmin.listMetrics() });
  } catch (err) {
    console.error('[nps] list metrics failed:', err.message);
    res.status(500).json({ error: 'Failed to load metrics' });
  }
});

router.post('/metrics', async (req, res) => {
  try {
    const { key, label, description } = req.body || {};
    const result = await npsAdmin.createMetric({ key, label, description });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_metric_created', {
      target: result.metric.id, metadata: { key: result.metric.key }, ip: req.ip,
    });
    res.json({ metric: result.metric });
  } catch (err) {
    console.error('[nps] create metric failed:', err.message);
    res.status(500).json({ error: 'Failed to create metric' });
  }
});

// Retire, never delete: every score row is keyed to this by string.
router.patch('/metrics/:id', async (req, res) => {
  try {
    const result = await npsAdmin.setMetricActive({
      id: req.params.id, active: (req.body || {}).active,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    auditLog.record(req.staff?.id, 'nps_metric_updated', {
      target: req.params.id, metadata: { active: Boolean((req.body || {}).active) }, ip: req.ip,
    });
    res.json({ metric: result.metric });
  } catch (err) {
    console.error('[nps] update metric failed:', err.message);
    res.status(500).json({ error: 'Failed to update metric' });
  }
});

module.exports = router;
