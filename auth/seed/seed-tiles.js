require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function seedTiles() {
  // Get all location IDs
  const { data: locations } = await supabase.from('locations').select('id, name')
  if (!locations?.length) { console.error('No locations found'); process.exit(1) }

  const allLocationIds = locations.map(l => l.id)

  // Helper: create tile for all locations
  async function createForAll(tile) {
    for (const location_id of allLocationIds) {
      const row = { ...tile, location_id }
      const { error } = await supabase.from('custom_tiles').upsert(row, { onConflict: 'url,location_id', ignoreDuplicates: true })
      if (error && !error.message.includes('duplicate')) console.error('Error creating', tile.label, ':', error.message)
    }
  }

  // Helper: create group tile for all locations, return IDs by location
  async function createGroupForAll(tile) {
    const ids = {}
    for (const location_id of allLocationIds) {
      const row = { ...tile, location_id }
      const { data, error } = await supabase.from('custom_tiles').upsert(row, { onConflict: 'url,location_id' }).select().single()
      if (error) {
        // Try to find existing
        const { data: existing } = await supabase.from('custom_tiles').select('id').eq('label', tile.label).eq('location_id', location_id).single()
        if (existing) ids[location_id] = existing.id
        else console.error('Error creating group', tile.label, ':', error.message)
      } else {
        ids[location_id] = data.id
      }
    }
    return ids
  }

  console.log('Seeding tiles for', locations.length, 'locations...')

  // === Simple URL Tiles ===
  await createForAll({ label: 'Operandio', description: 'Operations', url: 'https://app.operandio.com/login', icon: '⚙️' })
  console.log('Created: Operandio')

  await createForAll({ label: 'VistaPrint', description: 'Print Shop', url: 'https://westcoaststrength.ourproshop.com', icon: '🖨️' })
  console.log('Created: VistaPrint')

  // === Reporting Group ===
  const reportingIds = await createGroupForAll({ label: 'Reporting', description: 'Reports', url: '', icon: '📊' })
  console.log('Created: Reporting group')

  // Reporting children
  for (const location_id of allLocationIds) {
    const parent_id = reportingIds[location_id]
    if (!parent_id) continue

    await supabase.from('custom_tiles').upsert(
      { label: 'Membership', description: 'Membership Reports', url: '', icon: '👥', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
    await supabase.from('custom_tiles').upsert(
      { label: 'PT', description: 'Personal Training Reports', url: '', icon: '💪', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
  }
  console.log('Created: Reporting children (Membership, PT)')

  // === Marketing Group ===
  const marketingIds = await createGroupForAll({ label: 'Marketing', description: 'Marketing Tools', url: '', icon: '📢' })
  console.log('Created: Marketing group')

  for (const location_id of allLocationIds) {
    const parent_id = marketingIds[location_id]
    if (!parent_id) continue

    await supabase.from('custom_tiles').upsert(
      { label: 'Google', description: 'Google Ads', url: 'https://ads.google.com', icon: '🔍', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
    await supabase.from('custom_tiles').upsert(
      { label: 'Facebook', description: 'Meta Ads', url: 'https://business.facebook.com', icon: '📘', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
  }
  console.log('Created: Marketing children (Google, Facebook)')

  // === Tickets Group ===
  const ticketIds = await createGroupForAll({ label: 'Tickets', description: 'Support Tickets', url: '', icon: '🎫' })
  console.log('Created: Tickets group')

  for (const location_id of allLocationIds) {
    const parent_id = ticketIds[location_id]
    if (!parent_id) continue

    await supabase.from('custom_tiles').upsert(
      { label: 'Add Catalog Item', description: 'Submit Request', url: 'https://forms.clickup.com/9011189579/f/8chqnub-2111/9VUXKVKZ5ED01B1LGK', icon: '📦', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
    await supabase.from('custom_tiles').upsert(
      { label: 'Add New Hire', description: 'Onboarding Form', url: 'https://forms.clickup.com/9011189579/f/8chqnub-2151/CZ3QFG9AMCIB8KHJ74', icon: '👤', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
    await supabase.from('custom_tiles').upsert(
      { label: 'Ticket Status', description: 'View Tickets', url: 'https://reporting.strengthcoastwest.com/tickets', icon: '📋', location_id, parent_id },
      { onConflict: 'url,location_id', ignoreDuplicates: true }
    )
  }
  console.log('Created: Tickets children (Add Catalog Item, Add New Hire, Ticket Status)')

  console.log('Tile seeding complete!')
}

seedTiles().catch(err => { console.error(err); process.exit(1) })
