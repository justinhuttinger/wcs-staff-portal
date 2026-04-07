const { createClient } = require('@supabase/supabase-js')

// Service role client — bypasses RLS, used for all server-side operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

module.exports = { supabaseAdmin }
