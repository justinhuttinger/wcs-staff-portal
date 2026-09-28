// Validation for Admin -> Clubs. Pure (no I/O) so every rule is unit-tested.
//
// The rules encode the known gotchas of adding a club:
// - slug is the lowercased name with no spaces (Paychex lookups, Operandio
//   parsing and background photos derive one from the other), so the name
//   must be a single word;
// - ABC club numbers are stored without leading zeros;
// - slug / name / club number are fixed once created: years of rows in other
//   tables are keyed by them.

const TEXT_MAX = 500

function str(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

function httpsUrl(v) {
  return /^https:\/\/\S+$/i.test(v)
}

/**
 * @param {object} input     request body
 * @param {object[]} existing current clubs (registry shape, incl. inactive)
 * @param {object} [opts]
 * @param {object|null} [opts.current] the club being edited (null = new club)
 * @returns {{ errors: string[], row?: object, secrets?: object }}
 *   row: public.clubs columns to write; secrets: { ghlApiKey?, paychexCompanyId? }
 *   (a secret is only present when the admin typed a new value; '' is never sent)
 */
function validateClubInput(input, existing, { current = null } = {}) {
  const b = input || {}
  const errors = []
  const isNew = !current

  const name = isNew ? str(b.name) : current.name
  const clubNumber = isNew ? str(b.clubNumber).replace(/^0+/, '') : current.clubNumber
  const slug = name.toLowerCase()

  if (isNew) {
    if (!name) errors.push('Name is required.')
    else if (!/^[A-Za-z]+$/.test(name)) {
      errors.push('Name must be a single word of letters (for example "Medford"). The portal uses the lowercased name as the club\'s slug.')
    }
    if (!/^[1-9][0-9]{2,7}$/.test(clubNumber)) errors.push('ABC club number must be digits (for example 32073).')
    const others = existing || []
    if (name && others.some(c => c.slug === slug)) errors.push(`A club named ${name} already exists.`)
    if (clubNumber && others.some(c => c.clubNumber === clubNumber)) errors.push(`Club number ${clubNumber} is already used.`)
  } else {
    const same = {
      name: (v) => v === current.name,
      slug: (v) => v.toLowerCase() === current.slug,
      clubNumber: (v) => v.replace(/^0+/, '') === current.clubNumber,
    }
    for (const [k, label] of [['name', 'Name'], ['slug', 'Slug'], ['clubNumber', 'Club number']]) {
      if (str(b[k]) && !same[k](str(b[k]))) errors.push(`${label} can't be changed after a club is created.`)
    }
  }

  const pick = (k, fallback) => (b[k] === undefined ? fallback : str(b[k]))

  const ghlLocationId = pick('ghlLocationId', current?.ghlLocationId || '')
  if (ghlLocationId && !/^[A-Za-z0-9]{20}$/.test(ghlLocationId)) {
    errors.push('GHL location ID should be the 20-character sub-account ID from GHL settings.')
  }
  const abcUrl = pick('abcUrl', current?.abcUrl || '')
  if (abcUrl && !httpsUrl(abcUrl)) errors.push('ABC login URL must start with https://.')
  const background = pick('background', current?.background || '')
  if (background && !(httpsUrl(background) || /^\/[\w./-]+$/.test(background))) {
    errors.push('Background must be an https:// image URL or a path like /bg-medford.jpg.')
  }
  const timezone = pick('timezone', current?.timezone || 'America/Los_Angeles') || 'America/Los_Angeles'
  if (!validTimezone(timezone)) errors.push(`"${timezone}" isn't a timezone (use one like America/Los_Angeles).`)
  const state = pick('state', current?.state || 'Oregon') || 'Oregon'
  const tradingName = pick('tradingName', current?.tradingName || '')
  const active = b.active === undefined ? (current ? current.active : true) : b.active === true || b.active === 'true'

  for (const [label, v] of [['ABC login URL', abcUrl], ['Background', background], ['State', state], ['Trading name', tradingName]]) {
    if (v.length > TEXT_MAX) errors.push(`${label} is too long.`)
  }

  const secrets = {}
  const ghlApiKey = str(b.ghlApiKey)
  if (ghlApiKey) {
    if (!/^pit-[\w-]{8,}$/.test(ghlApiKey)) errors.push('GHL token should be a private integration token starting with pit-.')
    else secrets.ghlApiKey = ghlApiKey
  }
  const paychexCompanyId = str(b.paychexCompanyId)
  if (paychexCompanyId) {
    if (!/^[\w-]{1,64}$/.test(paychexCompanyId)) errors.push('Paychex company ID has unexpected characters.')
    else secrets.paychexCompanyId = paychexCompanyId
  }

  if (errors.length) return { errors }

  return {
    errors,
    row: {
      club_number: clubNumber,
      slug,
      name,
      env_key: slug.toUpperCase(),
      ghl_location_id: ghlLocationId || null,
      state,
      timezone,
      abc_url: abcUrl || null,
      background: background || null,
      trading_name: tradingName || null,
      active,
    },
    secrets,
  }
}

// Action Links every club follows (Admin -> Action Links can override).
function defaultActionLinks(slug) {
  return {
    [`dayone_url_${slug}`]: `https://book.westcoaststrength.com/dayone/${slug}`,
    [`vip_url_${slug}`]: `https://vip.westcoaststrength.com/${slug}/staff`,
  }
}

module.exports = { validateClubInput, defaultActionLinks }
