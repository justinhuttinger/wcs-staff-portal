const { supabaseAdmin } = require('./supabase')
const { encrypt, decrypt } = require('../utils/crypto')

async function listShared() {
  const { data, error } = await supabaseAdmin
    .from('shared_credentials')
    .select('id, service, encrypted_username, description, created_at, updated_at, created_by')
    .order('service')
  if (error) throw error
  // Don't return password to listings; only username and metadata.
  return (data || []).map(row => ({
    id: row.id,
    service: row.service,
    username: decrypt(row.encrypted_username),
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
  }))
}

async function getSharedByService(service) {
  const { data, error } = await supabaseAdmin
    .from('shared_credentials')
    .select('id, service, encrypted_username, encrypted_password')
    .eq('service', service)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    service: data.service,
    username: decrypt(data.encrypted_username),
    password: decrypt(data.encrypted_password),
  }
}

async function getAllShared() {
  // Returns { service: { username, password } } map for merge into /vault/credentials.
  const { data, error } = await supabaseAdmin
    .from('shared_credentials')
    .select('service, encrypted_username, encrypted_password')
  if (error) throw error
  return (data || []).map(row => ({
    service: row.service,
    username: decrypt(row.encrypted_username),
    password: decrypt(row.encrypted_password),
  }))
}

async function upsertShared(service, username, password, description, createdBy) {
  const row = {
    service,
    encrypted_username: encrypt(username),
    encrypted_password: encrypt(password),
    description: description || null,
    updated_at: new Date().toISOString(),
  }
  if (createdBy) row.created_by = createdBy

  const { data, error } = await supabaseAdmin
    .from('shared_credentials')
    .upsert(row, { onConflict: 'service' })
    .select()
    .single()
  if (error) throw error
  return { id: data.id, service: data.service }
}

async function deleteShared(id) {
  const { error } = await supabaseAdmin
    .from('shared_credentials')
    .delete()
    .eq('id', id)
  if (error) throw error
}

module.exports = { listShared, getSharedByService, getAllShared, upsertShared, deleteShared }
