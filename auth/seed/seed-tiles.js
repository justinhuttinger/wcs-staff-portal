require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { createClient } = require('@supabase/supabase-js')

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function seedTiles() {
  const { data: locations } = await sb.from('locations').select('id, name')
  if (!locations?.length) { console.error('No locations found'); process.exit(1) }
  const allLocationIds = locations.map(l => l.id)

  async function createTile({ label, description, url, icon, parent_id, locationIds }) {
    const { data, error } = await sb.from('custom_tiles')
      .insert({ label, description, url: url || null, icon, parent_id: parent_id || null })
      .select().single()
    if (error) { console.error('Error creating', label, ':', error.message); return null }

    const links = (locationIds || allLocationIds).map(lid => ({ tile_id: data.id, location_id: lid }))
    await sb.from('tile_locations').insert(links)
    return data
  }

  console.log('Seeding tiles for', locations.length, 'locations...')

  // Simple URL tiles
  await createTile({ label: 'Operandio', description: 'Operations', url: 'https://app.operandio.com/login', icon: '⚙️' })
  console.log('+ Operandio')

  await createTile({ label: 'VistaPrint', description: 'Print Shop', url: 'https://westcoaststrength.ourproshop.com', icon: '🖨️' })
  console.log('+ VistaPrint')

  // Reporting group
  const reporting = await createTile({ label: 'Reporting', description: 'Reports', icon: '📊' })
  if (reporting) {
    await createTile({ label: 'Membership', description: 'Membership Reports', icon: '👥', parent_id: reporting.id })
    await createTile({ label: 'PT', description: 'Personal Training Reports', icon: '💪', parent_id: reporting.id })
    console.log('+ Reporting (Membership, PT)')
  }

  // Marketing group
  const marketing = await createTile({ label: 'Marketing', description: 'Marketing Tools', icon: '📢' })
  if (marketing) {
    await createTile({ label: 'Google', description: 'Google Ads', url: 'https://ads.google.com', icon: '🔍', parent_id: marketing.id })
    await createTile({ label: 'Facebook', description: 'Meta Ads', url: 'https://business.facebook.com', icon: '📘', parent_id: marketing.id })
    console.log('+ Marketing (Google, Facebook)')
  }

  // Tickets group
  const tickets = await createTile({ label: 'Tickets', description: 'Support Tickets', icon: '🎫' })
  if (tickets) {
    await createTile({ label: 'Add Catalog Item', description: 'Submit Request', url: 'https://forms.clickup.com/9011189579/f/8chqnub-2111/9VUXKVKZ5ED01B1LGK', icon: '📦', parent_id: tickets.id })
    await createTile({ label: 'Add New Hire', description: 'Onboarding Form', url: 'https://forms.clickup.com/9011189579/f/8chqnub-2151/CZ3QFG9AMCIB8KHJ74', icon: '👤', parent_id: tickets.id })
    await createTile({ label: 'Ticket Status', description: 'View Tickets', url: 'https://reporting.strengthcoastwest.com/tickets', icon: '📋', parent_id: tickets.id })
    console.log('+ Tickets (Add Catalog Item, Add New Hire, Ticket Status)')
  }

  console.log('Done!')
}

seedTiles().catch(err => { console.error(err); process.exit(1) })
