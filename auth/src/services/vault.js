const { supabaseAdmin } = require('./supabase')
const { encrypt, decrypt } = require('../utils/crypto')

async function storeCredential(staffId, service, username, password, locationId) {
  const encrypted_username = encrypt(username)
  const encrypted_password = encrypt(password)

  const row = {
    staff_id: staffId,
    service,
    encrypted_username,
    encrypted_password,
    location_id: locationId || null,
  }

  const { data, error } = await supabaseAdmin
    .from('credential_vault')
    .upsert(row, { onConflict: 'staff_id,service,location_id' })
    .select()
    .single()

  if (error) throw error
  return data
}

async function getCredentials(staffId, service, locationId) {
  let query = supabaseAdmin
    .from('credential_vault')
    .select('id, staff_id, service, encrypted_username, encrypted_password, location_id, created_at, updated_at')
    .eq('staff_id', staffId)

  if (service) query = query.eq('service', service)
  if (locationId) query = query.eq('location_id', locationId)

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(row => ({
    id: row.id,
    staff_id: row.staff_id,
    service: row.service,
    username: decrypt(row.encrypted_username),
    password: decrypt(row.encrypted_password),
    location_id: row.location_id,
  }))
}

async function getCredentialById(id) {
  const { data, error } = await supabaseAdmin
    .from('credential_vault')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

async function updateCredential(id, username, password) {
  const updates = {}
  if (username) updates.encrypted_username = encrypt(username)
  if (password) updates.encrypted_password = encrypt(password)

  const { data, error } = await supabaseAdmin
    .from('credential_vault')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

async function deleteCredential(id) {
  const { error } = await supabaseAdmin
    .from('credential_vault')
    .delete()
    .eq('id', id)

  if (error) throw error
}

module.exports = { storeCredential, getCredentials, getCredentialById, updateCredential, deleteCredential }
