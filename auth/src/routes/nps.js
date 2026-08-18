const { Router } = require('express');
const authenticate = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { testFire } = require('../services/npsTestFire');
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

module.exports = router;
