// The rows every memo reader needs, so the portal, WCS ABC and the iPads agree on
// what's live.
const { supabaseAdmin } = require('./supabase')

async function loadEditions(client = supabaseAdmin) {
  const { data, error } = await client
    .from('memo_editions').select('id, month, status, items, starts_at, ends_at')
  if (error) throw error
  return data || []
}

async function loadNotes(slugs, client = supabaseAdmin) {
  if (!slugs.length) return []
  const { data, error } = await client
    .from('club_memos').select('id, edition_id, club_slug, status, items, starts_at, ends_at')
    .in('club_slug', slugs)
    .eq('status', 'published')
  if (error) throw error
  return data || []
}

module.exports = { loadEditions, loadNotes }
