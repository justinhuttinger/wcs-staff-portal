const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const sharedCreds = require('../services/sharedCredentials')

const router = Router()

router.use(authenticate)
router.use(requireRole('admin'))

// GET /admin/shared-credentials — list all shared credentials (no passwords)
router.get('/', async (req, res) => {
  try {
    const credentials = await sharedCreds.listShared()
    res.json({ credentials })
  } catch (err) {
    console.error('[shared-credentials] list failed:', err.message)
    res.status(500).json({ error: 'Failed to list shared credentials' })
  }
})

// POST /admin/shared-credentials — upsert a shared credential by service
router.post('/', async (req, res) => {
  const { service, username, password, description } = req.body
  if (!service || !username || !password) {
    return res.status(400).json({ error: 'service, username, and password are required' })
  }
  try {
    const cred = await sharedCreds.upsertShared(service.trim(), username, password, description, req.staff.id)
    res.status(201).json({ credential: cred })
  } catch (err) {
    console.error('[shared-credentials] upsert failed:', err.message)
    res.status(500).json({ error: 'Failed to save shared credential: ' + err.message })
  }
})

// DELETE /admin/shared-credentials/:id
router.delete('/:id', async (req, res) => {
  try {
    await sharedCreds.deleteShared(req.params.id)
    res.json({ message: 'Shared credential deleted' })
  } catch (err) {
    console.error('[shared-credentials] delete failed:', err.message)
    res.status(500).json({ error: 'Failed to delete shared credential' })
  }
})

module.exports = router
