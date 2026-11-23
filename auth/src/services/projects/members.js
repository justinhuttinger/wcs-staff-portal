// Projects membership check, shared by the Projects routes and /auth/me (which
// decides whether the tile shows). Any failure, including the table not
// existing yet, answers false.
const { supabaseAdmin } = require('../supabase')

async function isProjectsMember(staffId) {
  if (!staffId) return false
  try {
    const { data, error } = await supabaseAdmin.from('project_members').select('staff_id')
      .eq('staff_id', staffId).maybeSingle()
    return !error && !!data
  } catch { return false }
}

module.exports = { isProjectsMember }
