const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { getCompanies, getWorkers, getWorkerDocuments, getWorkerDocument, uploadWorkerDocument } = require('../services/paychex')
const { getPaychexBySlug, PAYCHEX_LOCATIONS } = require('../config/paychexLocations')

const router = Router()
router.use(authenticate)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REASON_LABELS = {
  coaching_conversation: 'Coaching Conversation',
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  termination: 'Termination',
}

/**
 * Build an HTML document for the HR form, suitable for PDF rendering.
 */
function buildDocumentHTML({ employee_name, manager_name, reason, short_reason, body, action_plan, manager_signature, employee_signature, employee_acknowledged, employee_acknowledged_at, created_at, location_slug }) {
  const dateStr = new Date(created_at || Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const ackSection = employee_acknowledged
    ? `<div style="margin-top:32px;">
        <h3 style="margin-bottom:8px;">Employee Acknowledgment</h3>
        <p>I acknowledge receipt of this document on ${new Date(employee_acknowledged_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.</p>
        <p style="margin-top:16px;"><strong>Employee Signature:</strong></p>
        ${employee_signature && employee_signature.startsWith('data:image')
          ? `<img src="${employee_signature}" style="height:60px;margin-top:4px;" />`
          : `<span style="font-family:cursive;font-size:18px;">${employee_signature || ''}</span>`
        }
      </div>`
    : `<div style="margin-top:32px;">
        <h3 style="margin-bottom:8px;">Employee Acknowledgment</h3>
        <p style="color:#888;">Not yet acknowledged</p>
        <p style="margin-top:16px;border-bottom:1px solid #333;width:300px;">&nbsp;</p>
        <p style="font-size:12px;color:#666;">Employee Signature</p>
      </div>`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; color: #222; }
    .header { background: #C41E24; color: #fff; padding: 24px 40px; display: flex; align-items: center; gap: 16px; }
    .header img { height: 48px; width: 48px; border-radius: 50%; }
    .header-text h1 { margin: 0; font-size: 24px; letter-spacing: 1px; }
    .header-text h2 { margin: 4px 0 0; font-size: 14px; font-weight: 400; opacity: 0.8; }
    .header-text h3 { margin: 2px 0 0; font-size: 12px; font-weight: 400; opacity: 0.65; }
    .content { padding: 32px 40px; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .meta-row span { font-size: 14px; }
    .body-text { margin-top: 24px; line-height: 1.7; white-space: pre-wrap; }
    .signature-section { margin-top: 40px; }
    .signature-section p { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="header">
    <img src="${process.env.PORTAL_URL || 'https://portal.wcstrength.com'}/wcs-logo.png" alt="WCS" />
    <div class="header-text">
      <h1>West Coast Strength</h1>
      <h2>${REASON_LABELS[reason] || reason}</h2>
      ${location_slug ? `<h3>${location_slug.charAt(0).toUpperCase() + location_slug.slice(1)}</h3>` : ''}
    </div>
  </div>
  <div class="content">
    <div class="meta-row"><span><strong>Date:</strong> ${dateStr}</span></div>
    <div class="meta-row"><span><strong>Manager:</strong> ${manager_name}</span></div>
    <div class="meta-row"><span><strong>Employee:</strong> ${employee_name}</span></div>
    ${short_reason ? `<div class="meta-row"><span><strong>Reason:</strong> ${short_reason}</span></div>` : ''}

    <div class="body-text">${body}</div>

    ${action_plan ? `<div style="margin-top:24px;">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:8px;">Action Plan / Next Steps</h3>
      <div class="body-text" style="margin-top:0;">${action_plan}</div>
    </div>` : ''}

    <div class="signature-section">
      <p><strong>Manager Signature:</strong></p>
      ${manager_signature && manager_signature.startsWith('data:image')
        ? `<img src="${manager_signature}" style="height:60px;margin-top:4px;" />`
        : `<span style="font-family:cursive;font-size:18px;">${manager_signature || ''}</span>`
      }
    </div>

    ${ackSection}
  </div>
</body>
</html>`
}

/**
 * Generate a PDF via PDFShift. Returns a Buffer, or null if API key is missing.
 */
async function generatePDF(htmlContent) {
  const apiKey = process.env.PDFSHIFT_API_KEY
  if (!apiKey) {
    console.warn('[HRDocuments] PDFSHIFT_API_KEY not set — skipping PDF generation')
    return null
  }

  const resp = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source: htmlContent, format: 'Letter' }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`PDFShift error ${resp.status}: ${text}`)
  }

  return Buffer.from(await resp.arrayBuffer())
}

/**
 * Resolve a staff member's location slug from their primary_location_id.
 */
async function resolveLocationSlug(staff) {
  if (!staff.primary_location_id) return null
  const { data } = await supabaseAdmin
    .from('locations')
    .select('name')
    .eq('id', staff.primary_location_id)
    .maybeSingle()
  return data?.name?.toLowerCase() || null
}

// ---------------------------------------------------------------------------
// POST /hr-documents  (manager+)
// Accepts workerId to auto-upload to Paychex after PDF generation.
// employee_signature is optional — if provided, document starts as 'completed'.
// ---------------------------------------------------------------------------
router.post('/', requireRole('manager'), async (req, res) => {
  const { employee_name, reason, short_reason, body, description, action_plan, manager_signature, employee_signature, worker_id } = req.body
  const docBody = body || description

  if (!employee_name || !reason || !docBody || !manager_signature) {
    return res.status(400).json({ error: 'employee_name, reason, description, and manager_signature are required' })
  }

  const validReasons = ['coaching_conversation', 'verbal_warning', 'written_warning', 'termination']
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ error: 'Invalid reason. Must be one of: ' + validReasons.join(', ') })
  }

  try {
    const managerName = req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ')
    const locationSlug = await resolveLocationSlug(req.staff)

    const hasEmployeeSig = !!employee_signature

    const insertPayload = {
      employee_name,
      reason,
      short_reason: short_reason || null,
      body: docBody,
      manager_signature,
      manager_name: managerName,
      submitted_by: req.staff.id,
      location_slug: locationSlug,
      action_plan: action_plan?.trim() || null,
      worker_id: worker_id || null,
      status: 'completed',
    }

    if (hasEmployeeSig) {
      insertPayload.employee_signature = employee_signature
      insertPayload.employee_acknowledged = true
      insertPayload.employee_acknowledged_at = new Date().toISOString()
    }

    const { data, error } = await supabaseAdmin
      .from('hr_documents')
      .insert(insertPayload)
      .select()
      .single()

    if (error) throw error

    // Generate PDF and auto-upload to Paychex if workerId provided
    try {
      const html = buildDocumentHTML(data)
      const pdfBuffer = await generatePDF(html)
      if (pdfBuffer) {
        const dataUrl = 'data:application/pdf;base64,' + pdfBuffer.toString('base64')
        const updates = { pdf_url: dataUrl }

        // Auto-upload to Paychex if worker_id is provided
        if (worker_id) {
          try {
            const fileName = `hr_${data.reason}_${data.employee_name.replace(/\s+/g, '_')}_${data.id}.pdf`
            const result = await uploadWorkerDocument(worker_id, pdfBuffer, fileName)
            updates.paychex_document_id = result?.documentId || result?.id || null
            updates.status = 'uploaded'
          } catch (uploadErr) {
            console.error('[HRDocuments] Paychex auto-upload failed:', uploadErr.message)
            // Continue — document is still saved locally
          }
        }

        const { error: updateErr } = await supabaseAdmin
          .from('hr_documents')
          .update(updates)
          .eq('id', data.id)
        if (updateErr) console.error('[HRDocuments] Failed to update document:', updateErr.message)
        else Object.assign(data, updates)
      }
    } catch (pdfErr) {
      console.error('[HRDocuments] PDF generation failed:', pdfErr.message)
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('[HRDocuments] Error creating document:', err.message)
    res.status(500).json({ error: 'Failed to create document: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /hr-documents  (manager+)
// ---------------------------------------------------------------------------
router.get('/', requireRole('manager'), async (req, res) => {
  const { employee_name, reason, status, location_slug } = req.query

  try {
    let query = supabaseAdmin
      .from('hr_documents')
      .select('*')
      .order('created_at', { ascending: false })

    // Location scoping
    if (canSeeAllLocations(req.staff.role)) {
      if (location_slug) {
        query = query.eq('location_slug', location_slug)
      }
    } else {
      const primarySlug = await resolveLocationSlug(req.staff)
      query = query.eq('location_slug', primarySlug)
    }

    if (employee_name) query = query.ilike('employee_name', `%${employee_name}%`)
    if (reason) query = query.eq('reason', reason)
    if (status) query = query.eq('status', status)

    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50))
    const from = (page - 1) * limit
    query = query.range(from, from + limit - 1)

    const { data, error } = await query

    if (error) throw error

    res.json(data || [])
  } catch (err) {
    console.error('[HRDocuments] Error listing documents:', err.message)
    res.status(500).json({ error: 'Failed to list documents: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /hr-documents/paychex-workers  (manager+)
// Returns Paychex employees for the staff member's location (or ?slug= override for corporate/admin)
// ---------------------------------------------------------------------------
router.get('/paychex-workers', requireRole('manager'), async (req, res) => {
  if (!process.env.PAYCHEX_API_KEY || !process.env.PAYCHEX_API_SECRET) {
    return res.status(501).json({ error: 'Paychex integration not configured' })
  }

  try {
    let slug = req.query.slug
    if (!slug || !canSeeAllLocations(req.staff.role)) {
      slug = await resolveLocationSlug(req.staff)
    }
    if (!slug) {
      return res.status(400).json({ error: 'Could not determine location' })
    }

    const paychexLoc = getPaychexBySlug(slug)
    if (!paychexLoc) {
      return res.status(404).json({ error: `No Paychex company configured for location: ${slug}` })
    }

    const statusType = req.query.status || 'ACTIVE'
    const workers = await getWorkers(paychexLoc.companyId, statusType)

    // Return a simplified worker list for the frontend
    const simplified = workers.map(w => {
      // Extract email from communications array if available
      // Paychex may nest it as {type:'EMAIL', uri:'...'} or {emailAddress:'...'}
      const comms = w.communications || []
      const emailComm = comms.find(c =>
        c.type === 'EMAIL' || c.communicationType === 'EMAIL' ||
        c.emailAddress || (c.uri && c.uri.includes('@'))
      ) || {}
      const email = emailComm.emailAddress || emailComm.uri || emailComm.dialNumber || ''

      return {
        workerId: w.workerId,
        employeeId: w.employeeId,
        givenName: w.name?.givenName || '',
        familyName: w.name?.familyName || '',
        preferredName: w.name?.preferredName || '',
        displayName: [w.name?.givenName, w.name?.familyName].filter(Boolean).join(' '),
        email,
        status: w.currentStatus?.statusType || 'UNKNOWN',
        hireDate: w.hireDate,
      }
    })

    // Sort alphabetically by last name
    simplified.sort((a, b) => a.familyName.localeCompare(b.familyName))

    res.json({ workers: simplified, location: slug, companyId: paychexLoc.companyId })
  } catch (err) {
    console.error('[HRDocuments] Paychex workers fetch failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch workers: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /hr-documents/paychex-workers/:workerId/documents  (manager+)
// Returns documents from Paychex + local HR documents for this worker
// ---------------------------------------------------------------------------
router.get('/paychex-workers/:workerId/documents', requireRole('manager'), async (req, res) => {
  if (!process.env.PAYCHEX_API_KEY || !process.env.PAYCHEX_API_SECRET) {
    return res.status(501).json({ error: 'Paychex integration not configured' })
  }

  try {
    const { workerId } = req.params
    const { workerName } = req.query

    // Fetch Paychex documents
    let paychexDocs = []
    try {
      paychexDocs = await getWorkerDocuments(workerId)
    } catch (err) {
      console.error('[HRDocuments] Paychex documents fetch failed:', err.message)
      // Continue — still show local docs even if Paychex call fails
    }

    // Fetch local HR documents matching this worker's name
    let localDocs = []
    if (workerName) {
      const { data } = await supabaseAdmin
        .from('hr_documents')
        .select('*')
        .ilike('employee_name', `%${workerName}%`)
        .order('created_at', { ascending: false })
      localDocs = data || []
    }

    res.json({ paychexDocuments: paychexDocs, localDocuments: localDocs })
  } catch (err) {
    console.error('[HRDocuments] Worker documents fetch failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch worker documents: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /hr-documents/paychex-locations  (manager+)
// Returns configured Paychex locations (for location selector)
// ---------------------------------------------------------------------------
router.get('/paychex-locations', requireRole('manager'), async (req, res) => {
  const locations = PAYCHEX_LOCATIONS.map(l => ({ name: l.name, slug: l.slug }))
  res.json({ locations })
})

// ---------------------------------------------------------------------------
// GET /hr-documents/paychex-companies  (admin only)
// Discover all companies the API key has access to — use this to find real company IDs
// ---------------------------------------------------------------------------
router.get('/paychex-companies', requireRole('admin'), async (req, res) => {
  if (!process.env.PAYCHEX_API_KEY || !process.env.PAYCHEX_API_SECRET) {
    return res.status(501).json({ error: 'Paychex integration not configured' })
  }

  try {
    const companies = await getCompanies()
    res.json({ companies })
  } catch (err) {
    console.error('[HRDocuments] Paychex companies fetch failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch companies: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /hr-documents/:id  (manager+)
// ---------------------------------------------------------------------------
router.get('/:id', requireRole('manager'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('hr_documents')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Document not found' })

    res.json(data)
  } catch (err) {
    console.error('[HRDocuments] Error fetching document:', err.message)
    res.status(500).json({ error: 'Failed to fetch document: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// PUT /hr-documents/:id/acknowledge  (team_member+)
// ---------------------------------------------------------------------------
router.put('/:id/acknowledge', requireRole('team_member'), async (req, res) => {
  const { employee_signature } = req.body

  if (!employee_signature) {
    return res.status(400).json({ error: 'employee_signature is required' })
  }

  try {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('hr_documents')
      .select('status, employee_name, staff_id')
      .eq('id', req.params.id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) return res.status(404).json({ error: 'Document not found' })

    // Ownership check: only the assigned employee (or a manager+) can acknowledge
    const isOwner = existing.staff_id === req.staff.id
    const staffName = (req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ')).toLowerCase()
    const isNameMatch = existing.employee_name && existing.employee_name.toLowerCase() === staffName
    if (!isOwner && !isNameMatch) {
      const { ROLE_HIERARCHY, resolveRole } = require('../middleware/role')
      const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
      const managerLevel = ROLE_HIERARCHY.indexOf('manager')
      if (userLevel < managerLevel) {
        return res.status(403).json({ error: 'You can only acknowledge documents assigned to you' })
      }
    }

    if (existing.status === 'completed' || existing.status === 'uploaded') {
      return res.status(400).json({ error: 'Document has already been acknowledged' })
    }

    const now = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('hr_documents')
      .update({
        employee_signature,
        employee_acknowledged: true,
        employee_acknowledged_at: now,
        status: 'completed',
        updated_at: now,
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    // Re-generate PDF with acknowledgment included
    try {
      const html = buildDocumentHTML(data)
      const pdfBuffer = await generatePDF(html)
      if (pdfBuffer) {
        const dataUrl = 'data:application/pdf;base64,' + pdfBuffer.toString('base64')
        const { error: updateErr } = await supabaseAdmin
          .from('hr_documents')
          .update({ pdf_url: dataUrl })
          .eq('id', data.id)
        if (updateErr) console.error('[HRDocuments] Failed to update PDF after ack:', updateErr.message)
        else data.pdf_url = dataUrl
      }
    } catch (pdfErr) {
      console.error('[HRDocuments] PDF re-generation after ack failed:', pdfErr.message)
    }

    res.json(data)
  } catch (err) {
    console.error('[HRDocuments] Error acknowledging document:', err.message)
    res.status(500).json({ error: 'Failed to acknowledge document: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /hr-documents/:id/upload-paychex  (manager+)
// ---------------------------------------------------------------------------
router.post('/:id/upload-paychex', requireRole('manager'), async (req, res) => {
  if (!process.env.PAYCHEX_API_KEY || !process.env.PAYCHEX_API_SECRET) {
    return res.status(501).json({ error: 'Paychex integration not configured' })
  }

  try {
    const { data: doc, error: fetchErr } = await supabaseAdmin
      .from('hr_documents')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!doc) return res.status(404).json({ error: 'Document not found' })

    if (!doc.pdf_url) {
      return res.status(400).json({ error: 'No PDF available for this document. Generate the PDF first.' })
    }

    const { workerId } = req.body || {}
    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required in the request body' })
    }

    // Decode the base64 data URL back to a buffer
    const base64Data = doc.pdf_url.replace(/^data:application\/pdf;base64,/, '')
    const pdfBuffer = Buffer.from(base64Data, 'base64')
    const fileName = `hr_${doc.reason}_${doc.employee_name.replace(/\s+/g, '_')}_${doc.id}.pdf`

    const result = await uploadWorkerDocument(workerId, pdfBuffer, fileName)

    const paychexDocId = result?.documentId || result?.id || null

    const now = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('hr_documents')
      .update({
        paychex_document_id: paychexDocId,
        status: 'uploaded',
        updated_at: now,
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json(data)
  } catch (err) {
    console.error('[HRDocuments] Paychex upload failed:', err.message)
    res.status(500).json({ error: 'Paychex upload failed: ' + err.message })
  }
})

module.exports = router
