const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole, ROLE_HIERARCHY } = require('../middleware/role')
const vault = require('../services/vault')
const sharedCreds = require('../services/sharedCredentials')

const router = Router()

router.use(authenticate)

// GET /vault/credentials?service=abc&location_id=xxx
// Returns the staff's personal credentials plus any shared credentials for
// services they don't have personal entries for. Shared credentials are
// keyed by service only; personal entries take precedence when both exist.
router.get('/credentials', async (req, res) => {
  try {
    const personal = await vault.getCredentials(
      req.staff.id,
      req.query.service,
      req.query.location_id
    )

    let allShared = []
    try {
      allShared = await sharedCreds.getAllShared()
    } catch (sharedErr) {
      console.error('[vault] failed to load shared credentials:', sharedErr.message)
    }

    const personalServices = new Set(personal.map(p => p.service))
    let sharedFiltered = allShared.filter(s => !personalServices.has(s.service))
    if (req.query.service) {
      sharedFiltered = sharedFiltered.filter(s => s.service === req.query.service)
    }

    const credentials = [
      ...personal,
      ...sharedFiltered.map(s => ({
        id: null,
        staff_id: null,
        service: s.service,
        username: s.username,
        password: s.password,
        location_id: null,
        shared: true,
      })),
    ]

    res.json({ credentials })
  } catch (err) {
    console.error('[vault] credentials fetch failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch credentials' })
  }
})

// POST /vault/credentials
router.post('/credentials', async (req, res) => {
  const { staff_id, service, username, password, location_id } = req.body

  if (!staff_id || !service || !username || !password) {
    return res.status(400).json({ error: 'staff_id, service, username, and password are required' })
  }

  if (staff_id !== req.staff.id) {
    const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
    const directorLevel = ROLE_HIERARCHY.indexOf('corporate')
    if (userLevel < directorLevel) {
      return res.status(403).json({ error: 'Only directors and above can manage other staff credentials' })
    }
  }

  try {
    const data = await vault.storeCredential(staff_id, service, username, password, location_id)
    res.status(201).json({ credential: { id: data.id, service, staff_id, location_id: location_id || null } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to store credential' })
  }
})

// PUT /vault/credentials/:id
router.put('/credentials/:id', async (req, res) => {
  const { username, password } = req.body

  try {
    const existing = await vault.getCredentialById(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Credential not found' })

    if (existing.staff_id !== req.staff.id) {
      const { resolveRole } = require('../middleware/role')
      const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
      const directorLevel = ROLE_HIERARCHY.indexOf('corporate')
      if (userLevel < directorLevel) {
        return res.status(403).json({ error: 'Only directors and above can manage other staff credentials' })
      }
    }

    await vault.updateCredential(req.params.id, username, password)
    res.json({ message: 'Credential updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update credential' })
  }
})

// DELETE /vault/credentials/:id — admin only
router.delete('/credentials/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = await vault.getCredentialById(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Credential not found' })

    await vault.deleteCredential(req.params.id)
    res.json({ message: 'Credential deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete credential' })
  }
})

module.exports = router
