const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// Field key mapping — GHL custom field keys to our column names
const FIELD_MAP = {
  'contact.member_sign_date': 'member_sign_date',
  'contact.day_one_booking_date': 'day_one_booking_date',
  'contact.day_one_date': 'day_one_date',
  'contact.day_one_sale': 'day_one_sale',
  'contact.day_one_trainer': 'day_one_trainer',
  'contact.day_one_booking_team_member': 'day_one_booking_team_member',
  'contact.day_one_status': 'day_one_status',
  'contact.show_or_no_show': 'show_or_no_show',
  'contact.sale_team_member': 'sale_team_member',
  'contact.tour_team_member': 'tour_team_member',
  'contact.same_day_sale': 'same_day_sale',
  'contact.pt_sign_date': 'pt_sign_date',
  'contact.pt_sale_type': 'pt_sale_type',
  'contact.pt_value': 'pt_value',
  'contact.pt_deactivate_date': 'pt_deactivate_date',
  'contact._of_vips': 'vip_count',
  'contact.membership_type': 'membership_type',
  'contact.active': 'active',
  'contact.origin': 'origin',
  'contact.cancel_date': 'cancel_date',
  'contact.sale_date': 'sale_date',
  'contact.trial_start_date': 'trial_start_date',
}

function parseDate(val) {
  if (!val) return null
  // GHL sometimes sends timestamps as numbers (milliseconds)
  if (typeof val === 'number') return new Date(val).toISOString().split('T')[0]
  if (typeof val === 'string' && val.length > 0) {
    const d = new Date(val)
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
  }
  return null
}

function extractCustomFields(contact) {
  const result = {}
  const customFields = contact.customFields || contact.customField || []

  // Build a lookup of field ID -> field key from the contact's custom fields
  for (const field of customFields) {
    const fieldKey = field.fieldKey || field.key || ''
    const columnName = FIELD_MAP[fieldKey]
    if (!columnName) continue

    let value = field.value
    // Handle date fields
    if (columnName.includes('date') || columnName === 'trial_start_date') {
      value = parseDate(value)
    }
    // Handle numeric fields
    if (columnName === 'pt_value' || columnName === 'vip_count') {
      value = typeof value === 'number' ? value : (parseFloat(value) || null)
    }
    result[columnName] = value
  }

  return result
}

async function fetchGHLContacts(apiKey, locationId) {
  const contacts = []
  let offset = 0
  const limit = 100
  let hasMore = true

  while (hasMore) {
    const params = new URLSearchParams({
      locationId,
      limit: limit.toString(),
      startAfter: offset.toString(),
    })

    const res = await fetch(
      'https://services.leadconnectorhq.com/contacts/?' + params.toString(),
      {
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
        },
      }
    )

    if (!res.ok) {
      console.error('GHL contacts error:', res.status, await res.text())
      break
    }

    const data = await res.json()
    const batch = data.contacts || []
    contacts.push(...batch)

    if (batch.length < limit) {
      hasMore = false
    } else {
      offset += limit
    }

    // Safety: max 20000 contacts per location per sync
    if (contacts.length >= 20000) break
  }

  return contacts
}

async function fetchGHLOpportunities(apiKey, locationId) {
  const opportunities = []
  let startAfter = 0
  const limit = 100
  let hasMore = true

  while (hasMore) {
    const res = await fetch(
      'https://services.leadconnectorhq.com/opportunities/search?' +
        new URLSearchParams({ location_id: locationId, limit: limit.toString(), startAfter: startAfter.toString() }).toString(),
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
        },
      }
    )

    if (!res.ok) {
      console.error('GHL opportunities error:', res.status, await res.text())
      break
    }

    const data = await res.json()
    const batch = data.opportunities || []
    opportunities.push(...batch)

    if (batch.length < limit) {
      hasMore = false
    } else {
      startAfter += limit
    }

    if (opportunities.length >= 10000) break
  }

  return opportunities
}

// POST /sync/contacts — sync contacts for all locations (or ?location_id=xxx for one)
// ?bg=true responds immediately and processes in background
router.post('/contacts', async (req, res) => {
  const incremental = req.query.full !== 'true'
  const background = req.query.bg === 'true'

  if (background) {
    res.json({ status: 'started', message: 'Sync running in background. Check /sync/status for progress.' })
  }

  const doSync = async () => {
  try {
    const { data: locations } = await supabaseAdmin
      .from('locations')
      .select('id, name, ghl_location_id, ghl_api_key')

    const targetLocations = req.query.location_id
      ? locations.filter(l => l.id === req.query.location_id)
      : locations.filter(l => l.ghl_api_key && l.ghl_location_id)

    const results = {}

    for (const loc of targetLocations) {
      try {
        const contacts = await fetchGHLContacts(loc.ghl_api_key, loc.ghl_location_id)

        let upserted = 0
        for (const contact of contacts) {
          const customFields = extractCustomFields(contact)

          const row = {
            ghl_contact_id: contact.id,
            location_id: loc.id,
            first_name: contact.firstName || null,
            last_name: contact.lastName || null,
            email: contact.email || null,
            phone: contact.phone || null,
            tags: contact.tags || [],
            synced_at: new Date().toISOString(),
            ...customFields,
          }

          const { error } = await supabaseAdmin
            .from('ghl_contacts')
            .upsert(row, { onConflict: 'ghl_contact_id' })

          if (!error) upserted++
        }

        results[loc.name] = { fetched: contacts.length, upserted }
        console.log(`Synced ${loc.name}: ${contacts.length} contacts, ${upserted} upserted`)
      } catch (err) {
        results[loc.name] = { error: err.message }
        console.error(`Failed to sync ${loc.name}:`, err.message)
      }
    }

    if (!background) res.json({ success: true, results })
    console.log('Contact sync results:', JSON.stringify(results))
  } catch (err) {
    if (!background) res.status(500).json({ error: err.message })
    console.error('Contact sync error:', err.message)
  }
  }

  if (background) {
    doSync()
  } else {
    await doSync()
  }
})

// POST /sync/opportunities — sync opportunities for all locations
router.post('/opportunities', async (req, res) => {
  try {
    const { data: locations } = await supabaseAdmin
      .from('locations')
      .select('id, name, ghl_location_id, ghl_api_key')

    const targetLocations = req.query.location_id
      ? locations.filter(l => l.id === req.query.location_id)
      : locations.filter(l => l.ghl_api_key && l.ghl_location_id)

    // First, fetch pipeline info to get names
    const pipelineCache = {}

    const results = {}

    for (const loc of targetLocations) {
      try {
        // Get pipelines for this location
        const pipRes = await fetch(
          'https://services.leadconnectorhq.com/opportunities/pipelines?locationId=' + loc.ghl_location_id,
          {
            headers: {
              'Authorization': 'Bearer ' + loc.ghl_api_key,
              'Version': '2021-07-28',
            },
          }
        )

        if (pipRes.ok) {
          const pipData = await pipRes.json()
          for (const pipeline of (pipData.pipelines || [])) {
            pipelineCache[pipeline.id] = {
              name: pipeline.name,
              stages: {}
            }
            for (const stage of (pipeline.stages || [])) {
              pipelineCache[pipeline.id].stages[stage.id] = stage.name
            }
          }
        }

        const opportunities = await fetchGHLOpportunities(loc.ghl_api_key, loc.ghl_location_id)

        let upserted = 0
        for (const opp of opportunities) {
          const pipeline = pipelineCache[opp.pipelineId] || {}

          const row = {
            ghl_opportunity_id: opp.id,
            ghl_contact_id: opp.contactId || null,
            location_id: loc.id,
            pipeline_id: opp.pipelineId || null,
            pipeline_name: pipeline.name || null,
            stage_id: opp.pipelineStageId || null,
            stage_name: pipeline.stages?.[opp.pipelineStageId] || null,
            status: opp.status || null,
            contact_name: opp.contactName || opp.name || null,
            contact_email: opp.contactEmail || null,
            assigned_to: opp.assignedTo || null,
            monetary_value: opp.monetaryValue || null,
            source: opp.source || null,
            created_date: opp.createdAt || null,
            updated_date: opp.updatedAt || null,
            synced_at: new Date().toISOString(),
          }

          const { error } = await supabaseAdmin
            .from('ghl_opportunities')
            .upsert(row, { onConflict: 'ghl_opportunity_id' })

          if (!error) upserted++
        }

        results[loc.name] = { fetched: opportunities.length, upserted, pipelines: Object.keys(pipelineCache).length }
        console.log(`Synced ${loc.name}: ${opportunities.length} opportunities, ${upserted} upserted`)
      } catch (err) {
        results[loc.name] = { error: err.message }
        console.error(`Failed to sync ${loc.name} opportunities:`, err.message)
      }
    }

    res.json({ success: true, results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /sync/all — sync both contacts and opportunities
router.post('/all', async (req, res) => {
  try {
    // Sync contacts
    const contactsRes = await fetch(req.protocol + '://' + req.get('host') + '/sync/contacts' + (req.query.full === 'true' ? '?full=true' : ''), { method: 'POST' })
    const contactsData = await contactsRes.json()

    // Sync opportunities
    const oppsRes = await fetch(req.protocol + '://' + req.get('host') + '/sync/opportunities', { method: 'POST' })
    const oppsData = await oppsRes.json()

    res.json({ contacts: contactsData, opportunities: oppsData })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Export sync functions for direct cron use (no HTTP timeout)
router.syncContactsForLocation = async function(loc) {
  const contacts = await fetchGHLContacts(loc.ghl_api_key, loc.ghl_location_id)
  let upserted = 0
  for (const contact of contacts) {
    const customFields = extractCustomFields(contact)
    const row = {
      ghl_contact_id: contact.id,
      location_id: loc.id,
      first_name: contact.firstName || null,
      last_name: contact.lastName || null,
      email: contact.email || null,
      phone: contact.phone || null,
      tags: contact.tags || [],
      synced_at: new Date().toISOString(),
      ...customFields,
    }
    const { error } = await supabaseAdmin.from('ghl_contacts').upsert(row, { onConflict: 'ghl_contact_id' })
    if (!error) upserted++
  }
  return { fetched: contacts.length, upserted }
}

router.syncOpportunitiesForLocation = async function(loc) {
  const opportunities = await fetchGHLOpportunities(loc.ghl_api_key, loc.ghl_location_id)
  let upserted = 0
  // Fetch pipeline info
  const pipRes = await fetch('https://services.leadconnectorhq.com/opportunities/pipelines?locationId=' + loc.ghl_location_id, {
    headers: { 'Authorization': 'Bearer ' + loc.ghl_api_key, 'Version': '2021-07-28' }
  })
  const pipelineCache = {}
  if (pipRes.ok) {
    const pipData = await pipRes.json()
    for (const p of (pipData.pipelines || [])) {
      pipelineCache[p.id] = { name: p.name, stages: {} }
      for (const s of (p.stages || [])) pipelineCache[p.id].stages[s.id] = s.name
    }
  }
  for (const opp of opportunities) {
    const pipeline = pipelineCache[opp.pipelineId] || {}
    const row = {
      ghl_opportunity_id: opp.id,
      ghl_contact_id: opp.contactId || null,
      location_id: loc.id,
      pipeline_id: opp.pipelineId || null,
      pipeline_name: pipeline.name || null,
      stage_id: opp.pipelineStageId || null,
      stage_name: pipeline.stages?.[opp.pipelineStageId] || null,
      status: opp.status || null,
      contact_name: opp.contactName || opp.name || null,
      contact_email: opp.contactEmail || null,
      assigned_to: opp.assignedTo || null,
      monetary_value: opp.monetaryValue || null,
      source: opp.source || null,
      created_date: opp.createdAt || null,
      updated_date: opp.updatedAt || null,
      synced_at: new Date().toISOString(),
    }
    const { error } = await supabaseAdmin.from('ghl_opportunities').upsert(row, { onConflict: 'ghl_opportunity_id' })
    if (!error) upserted++
  }
  return { fetched: opportunities.length, upserted }
}

module.exports = router
