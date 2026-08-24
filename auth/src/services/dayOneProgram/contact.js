'use strict'

// Shape a GHL contact into the fields the generator, PDF and email use.
//
// Kept apart from pipeline.js so it can be tested without dragging in Supabase.
//
// GHL does not always return `name` - a contact created by upsert comes back
// with firstName and lastName only - and falling straight through to "Client"
// wrote that placeholder over people who had a perfectly good name.
function shapeContact(ghlContact = {}) {
  const c = ghlContact || {}
  const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')
  return {
    id: c.id,
    name: name.trim() || 'Client',
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email,
    phone: c.phone,
  }
}

module.exports = { shapeContact }
