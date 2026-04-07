const { Router } = require('express')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// OIDC Configuration
const ISSUER = process.env.OIDC_ISSUER || 'https://wcs-auth-api.onrender.com'
const CLIENT_ID = process.env.OIDC_CLIENT_ID || 'f6588abfac3490cfd85b22bb5e72787f'
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '8abcb11cfe3cef6797ac65c3da63cb5fb117a5456898d57e565bcd09cc280699'

// Generate RSA key pair for signing tokens (or use a static one from env)
let signingKey
let publicKeyJWK

function getSigningKey() {
  if (signingKey) return signingKey
  // Use OIDC_SIGNING_KEY env var if available, otherwise generate
  if (process.env.OIDC_SIGNING_KEY) {
    signingKey = process.env.OIDC_SIGNING_KEY
  } else {
    // Generate a symmetric key for HS256 signing
    signingKey = CLIENT_SECRET
  }
  return signingKey
}

// In-memory authorization code store (short-lived)
const authCodes = new Map()

// 1. OpenID Configuration (Discovery Document)
router.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: ISSUER,
    authorization_endpoint: ISSUER + '/oidc/authorize',
    token_endpoint: ISSUER + '/oidc/token',
    userinfo_endpoint: ISSUER + '/oidc/userinfo',
    jwks_uri: ISSUER + '/oidc/jwks',
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['sub', 'email', 'name', 'given_name', 'family_name', 'picture'],
  })
})

// 2. JWKS endpoint (for HS256 we don't expose public keys, but GHL may need this)
router.get('/jwks', (req, res) => {
  // For HS256, JWKS isn't really used, but we provide an empty response
  res.json({ keys: [] })
})

// 3. Authorization endpoint — GHL redirects users here to log in
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, nonce } = req.query

  if (client_id !== CLIENT_ID) {
    return res.status(400).send('Invalid client_id')
  }

  if (response_type !== 'code') {
    return res.status(400).send('Only response_type=code is supported')
  }

  // Show login page or check if user is already authenticated
  // For now, render a simple login form
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WCS Portal Login</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: #f4f5f7; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .card { background: white; border-radius: 16px; border: 1px solid #e2e4e8; padding: 32px; width: 100%; max-width: 380px; }
        h1 { font-size: 24px; font-weight: 900; color: #1a1a2e; margin-bottom: 4px; }
        h1 span { background: linear-gradient(to right, #e53e3e, #fc8181); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        p { font-size: 14px; color: #8b90a5; margin-bottom: 24px; }
        input { width: 100%; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e4e8; background: #f4f5f7; font-size: 14px; color: #1a1a2e; margin-bottom: 12px; outline: none; }
        input:focus { border-color: #e53e3e; box-shadow: 0 0 0 2px rgba(229,62,62,0.2); }
        button { width: 100%; padding: 12px; border-radius: 8px; background: #e53e3e; color: white; font-size: 14px; font-weight: 600; border: none; cursor: pointer; }
        button:hover { background: #c53030; }
        .error { color: #e53e3e; font-size: 13px; margin-bottom: 12px; display: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1><span>WCS</span> Staff Portal</h1>
        <p>Sign in to continue to GoHighLevel</p>
        <div class="error" id="error"></div>
        <form method="POST" action="/oidc/authorize">
          <input type="hidden" name="redirect_uri" value="${redirect_uri || ''}" />
          <input type="hidden" name="state" value="${state || ''}" />
          <input type="hidden" name="nonce" value="${nonce || ''}" />
          <input type="hidden" name="scope" value="${scope || 'openid'}" />
          <input type="email" name="email" placeholder="Email" required autofocus />
          <input type="password" name="password" placeholder="Password" required />
          <button type="submit">Sign In</button>
        </form>
      </div>
    </body>
    </html>
  `)
})

// 3b. Authorization POST — handle login form submission
router.post('/authorize', express.urlencoded({ extended: false }), async (req, res) => {
  const { email, password, redirect_uri, state, nonce, scope } = req.body

  try {
    // Authenticate with Supabase
    const { createClient } = require('@supabase/supabase-js')
    const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      return res.status(401).send(`
        <html><body><script>
          alert('Invalid email or password');
          history.back();
        </script></body></html>
      `)
    }

    // Get staff record
    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, first_name, last_name, role')
      .eq('id', authData.user.id)
      .single()

    if (!staff) {
      return res.status(401).send('Staff account not found')
    }

    // Generate authorization code
    const code = crypto.randomBytes(32).toString('hex')
    authCodes.set(code, {
      staffId: staff.id,
      email: staff.email,
      firstName: staff.first_name || staff.display_name?.split(' ')[0] || '',
      lastName: staff.last_name || staff.display_name?.split(' ')[1] || '',
      displayName: staff.display_name || (staff.first_name + ' ' + staff.last_name).trim(),
      nonce,
      scope,
      redirectUri: redirect_uri,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    })

    // Clean up expired codes
    for (const [key, val] of authCodes) {
      if (val.expiresAt < Date.now()) authCodes.delete(key)
    }

    // Redirect back to GHL with the authorization code
    const redirectUrl = new URL(redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (state) redirectUrl.searchParams.set('state', state)

    res.redirect(redirectUrl.toString())
  } catch (err) {
    console.error('OIDC authorize error:', err)
    res.status(500).send('Authentication failed')
  }
})

// Need express for urlencoded parsing
const express = require('express')

// 4. Token endpoint — GHL exchanges auth code for tokens
router.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
  const { grant_type, code, redirect_uri, client_id, client_secret } = req.body

  // Also check Authorization header for client credentials
  let reqClientId = client_id
  let reqClientSecret = client_secret
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString()
    const [id, secret] = decoded.split(':')
    reqClientId = reqClientId || id
    reqClientSecret = reqClientSecret || secret
  }

  if (reqClientId !== CLIENT_ID || reqClientSecret !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' })
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' })
  }

  const codeData = authCodes.get(code)
  if (!codeData) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code not found or expired' })
  }

  if (codeData.expiresAt < Date.now()) {
    authCodes.delete(code)
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' })
  }

  // Delete code (one-time use)
  authCodes.delete(code)

  const now = Math.floor(Date.now() / 1000)
  const key = getSigningKey()

  // Generate ID token
  const idToken = jwt.sign({
    iss: ISSUER,
    sub: codeData.staffId,
    aud: CLIENT_ID,
    exp: now + 3600,
    iat: now,
    nonce: codeData.nonce,
    email: codeData.email,
    name: codeData.displayName,
    given_name: codeData.firstName,
    family_name: codeData.lastName,
  }, key, { algorithm: 'HS256' })

  // Generate access token
  const accessToken = jwt.sign({
    iss: ISSUER,
    sub: codeData.staffId,
    aud: CLIENT_ID,
    exp: now + 3600,
    iat: now,
    scope: codeData.scope || 'openid profile email',
  }, key, { algorithm: 'HS256' })

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    id_token: idToken,
    scope: codeData.scope || 'openid profile email',
  })
})

// 5. UserInfo endpoint — GHL calls this to get user details
router.get('/userinfo', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' })
  }

  const token = authHeader.slice(7)
  try {
    const key = getSigningKey()
    const payload = jwt.verify(token, key, { algorithms: ['HS256'] })

    // Get staff details
    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, first_name, last_name')
      .eq('id', payload.sub)
      .single()

    if (!staff) {
      return res.status(401).json({ error: 'invalid_token' })
    }

    res.json({
      sub: staff.id,
      email: staff.email,
      name: staff.display_name || (staff.first_name + ' ' + staff.last_name).trim(),
      given_name: staff.first_name || '',
      family_name: staff.last_name || '',
    })
  } catch (err) {
    res.status(401).json({ error: 'invalid_token' })
  }
})

module.exports = router
