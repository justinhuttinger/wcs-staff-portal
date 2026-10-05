/**
 * /public/help-center/:token — UNAUTHENTICATED, read-only Help Center for the
 * front desk iPads (help.html?token=...).
 *
 * One secret token for the whole company, kept in app_config under
 * help_center_public_token and minted/reset by an admin from the Help Center
 * ("Front desk link"). Same model as the Group X attendance links: the token
 * IS the access, so a leaked link is fixed by resetting it.
 *
 * Only articles every staff member can already read are served: anything with
 * a Lead+ (or higher) role floor on the article or its category stays behind
 * the portal login.
 */
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { isFrontDeskVisible, HELP_TOKEN_KEY } = require('../lib/helpCenterPublic')

const router = Router()

async function tokenIsValid(token) {
  if (!token || token.length < 20) return false
  const { data, error } = await supabaseAdmin
    .from('app_config').select('value').eq('key', HELP_TOKEN_KEY).maybeSingle()
  if (error) throw new Error(error.message)
  return !!data?.value && data.value === token
}

// GET /public/help-center/:token — every front-desk article in one go, so the
// iPad can search and browse without another round trip.
router.get('/:token', async (req, res) => {
  try {
    if (!await tokenIsValid(req.params.token)) {
      return res.status(404).json({ error: 'This Help Center link is no longer active. Ask a manager for the new one.' })
    }
    const [{ data: cats, error: cErr }, { data: arts, error: aErr }] = await Promise.all([
      supabaseAdmin.from('help_categories').select('id, name, description, sort_order, min_role').order('sort_order').order('name'),
      supabaseAdmin.from('help_articles')
        .select('id, title, body, category_id, sort_order, min_role, updated_at, help_categories(min_role)')
        .order('sort_order').order('title'),
    ])
    if (cErr) throw cErr
    if (aErr) throw aErr

    const categories = (cats || []).filter(c => isFrontDeskVisible(c.min_role))
    const catIds = new Set(categories.map(c => c.id))
    const articles = (arts || [])
      .filter(a => isFrontDeskVisible(a.min_role) && isFrontDeskVisible(a.help_categories?.min_role))
      .filter(a => !a.category_id || catIds.has(a.category_id))
      .map(({ help_categories, min_role, ...a }) => a)

    res.set('Cache-Control', 'no-store')
    res.json({
      categories: categories.map(({ min_role, ...c }) => c),
      articles,
    })
  } catch (err) {
    console.error('[public-help-center] load failed:', err.message)
    res.status(500).json({ error: 'Could not load the Help Center' })
  }
})

module.exports = router
