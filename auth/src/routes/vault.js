const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole, ROLE_HIERARCHY } = require('../middleware/role')
const vault = require('../services/vault')

const router = Router()

router.use(authenticate)

// GET /vault/credentials?service=abc&location_id=xxx
router.get('/credentials', async (req, res) => {
  try {
    const credentials = await vault.getCredentials(
      req.staff.id,
      req.query.service,
      req.query.location_id
    )
    res.json({ credentials })
  } catch (err) {
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
