require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LOCATIONS = [
  { name: 'Salem', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  { name: 'Keizer', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/8qFo1GnePy0mCgV9avWW', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/HXB00WKKe6srvgSmfwI7' },
  { name: 'Eugene', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/0c9CNdZ65NainMcStWXo', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/xKYTE6V7QXKVpkUfWTFi' },
  { name: 'Springfield', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/PEyaqnkjmBN5tLpo6I9F', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/uM48yWzOBhXhUBsG1fhW' },
  { name: 'Clackamas', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/yOvDLsZMAboTVjv9c2HC', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/Z9zEHwjGfQaMIYy9OueF' },
  { name: 'Milwaukie', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  { name: 'Medford', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
]

const TOOLS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive']
const ROLES = ['front_desk', 'personal_trainer', 'manager', 'director', 'admin']

async function seed() {
  // Seed locations
  const { error: locError } = await supabase
    .from('locations')
    .upsert(LOCATIONS, { onConflict: 'name' })
  if (locError) throw new Error('Failed to seed locations: ' + locError.message)
  console.log('Seeded 7 locations')

  // Seed role_tool_visibility (all visible by default)
  const visibility = []
  for (const role of ROLES) {
    for (const tool_key of TOOLS) {
      visibility.push({ role, tool_key, visible: true })
    }
  }
  const { error: visError } = await supabase
    .from('role_tool_visibility')
    .upsert(visibility, { onConflict: 'role,tool_key' })
  if (visError) throw new Error('Failed to seed visibility: ' + visError.message)
  console.log('Seeded role_tool_visibility (' + visibility.length + ' rows)')

  // Create initial admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@wcstrength.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123'

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  })
  if (authError) {
    if (authError.message.includes('already been registered')) {
      console.log('Admin user already exists, skipping')
    } else {
      throw new Error('Failed to create admin user: ' + authError.message)
    }
  } else {
    const { error: staffError } = await supabase.from('staff').insert({
      id: authUser.user.id,
      email: adminEmail,
      display_name: 'Admin',
      role: 'admin',
      must_change_password: true,
    })
    if (staffError) throw new Error('Failed to create staff record: ' + staffError.message)

    // Assign admin to all locations
    const { data: locs } = await supabase.from('locations').select('id')
    const assignments = locs.map((loc, i) => ({
      staff_id: authUser.user.id,
      location_id: loc.id,
      is_primary: i === 0,
    }))
    const { error: assignError } = await supabase.from('staff_locations').insert(assignments)
    if (assignError) throw new Error('Failed to assign locations: ' + assignError.message)
    console.log('Created admin user: ' + adminEmail)
  }

  console.log('Seed complete!')
}

seed().catch(err => { console.error(err); process.exit(1) })
