const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { loadByToken, loadByQr, submitResponse, recordPreScore } = require('../services/npsPublic');

// Public survey renderer endpoints. Intentionally NOT behind authenticate:
// the invite token or the QR key IS the credential. Mirrors routes/publicForms.js.
const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10, // express-rate-limit v8: 'limit', not the deprecated 'max'
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
});

// Walk-up has no token to burn, so the render path is rate limited too. Tuned
// to stop idle repeat-submitting from one phone, not to trip on a busy Saturday.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in a minute.' },
});

function hashIp(req) {
  const ip = req.ip || '';
  return ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32) : null;
}

function publicSurvey(survey) {
  return {
    slug: survey.slug, title: survey.title,
    intro: survey.intro, schema: survey.schema || [],
  };
}

// GET /public/nps/:slug?t={token}  invited
// GET /public/nps/:slug?k={key}    walk-up
router.get('/:slug', readLimiter, async (req, res) => {
  try {
    const { t, k } = req.query;
    const result = t
      ? await loadByToken({ slug: req.params.slug, token: String(t) })
      : await loadByQr({ slug: req.params.slug, key: String(k || '') });

    if (!result.ok) {
      return res.status(404).json({
        error: 'This survey is not available',
        reason: result.reason || undefined,
      });
    }

    // ?s= carries the score clicked straight from the email. Record it before
    // responding so an abandoned survey still counts.
    if (t && req.query.s !== undefined) {
      await recordPreScore({ slug: req.params.slug, token: String(t), score: req.query.s });
    }

    res.json({
      survey: publicSurvey(result.survey),
      member: result.member || null,
    });
  } catch (err) {
    console.error('[publicNps] fetch failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

// POST /public/nps/:slug/submit
router.post('/:slug/submit', submitLimiter, async (req, res) => {
  try {
    const { t, k, answers } = req.body || {};
    const result = await submitResponse({
      slug: req.params.slug,
      token: t ? String(t) : undefined,
      key: k ? String(k) : undefined,
      answers,
      ipHash: hashIp(req),
      userAgent: (req.get('user-agent') || '').slice(0, 500),
    });

    if (!result.ok && result.status === 400) {
      return res.status(400).json({ errors: result.errors });
    }
    if (!result.ok) {
      return res.status(404).json({
        error: 'This survey is not available',
        reason: result.reason || undefined,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[publicNps] submit failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

module.exports = router;
