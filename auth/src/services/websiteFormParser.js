// Pure parser for the WCS website form webhook.
//
// Input:  already-url-decoded object (express.urlencoded() handles decoding).
//         Field names use friendly labels straight from the HTML form
//         ("First Name", "Last Name", "Email", "Phone", "Message",
//         "Opt In for Messaging") plus form_id / form_name.
//
// Output: { form_id, form_name, location, first_name, last_name, email,
//           phone, message, opt_in, raw }
//
// Anything not in the well-known list is preserved verbatim inside `raw`
// (which is the input object). The route handler writes that to the
// `website_submissions.raw` JSONB column so dynamic "No Label field_*"
// fields are never lost.

const KNOWN_LOCATIONS = [
  'Salem',
  'Keizer',
  'Eugene',
  'Springfield',
  'Clackamas',
  'Milwaukie',
  'Medford',
]

// Convention (per Justin 2026-05-14): all website form names start with the
// location followed by " - " or whitespace. e.g. "Springfield - Swim Sign Up".
// Match case-insensitively at the start of the string; require a word
// boundary so "Springfieldville" wouldn't match.
function parseLocation(formName) {
  if (!formName || typeof formName !== 'string') return null
  const trimmed = formName.trim()
  for (const loc of KNOWN_LOCATIONS) {
    const re = new RegExp('^' + loc + '\\b', 'i')
    if (re.test(trimmed)) return loc
  }
  return null
}

// Case-insensitive lookup against keys of an object. Returns the first
// match or undefined. HTML forms preserve case, so "First Name" is most
// likely — but we tolerate any case to be safe.
function pickField(body, label) {
  const target = label.toLowerCase()
  for (const key of Object.keys(body)) {
    if (key.toLowerCase() === target) return body[key]
  }
  return undefined
}

function coerceOptIn(value) {
  if (value === undefined || value === null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'on' || s === 'true' || s === '1' || s === 'yes'
}

function nonEmpty(value) {
  if (value === undefined || value === null) return null
  const s = String(value).trim()
  return s.length === 0 ? null : s
}

function parseWebsiteFormBody(body) {
  if (!body || typeof body !== 'object') {
    return null
  }
  const form_id = nonEmpty(pickField(body, 'form_id'))
  const form_name = nonEmpty(pickField(body, 'form_name'))
  const first_name = nonEmpty(pickField(body, 'First Name'))
  const last_name = nonEmpty(pickField(body, 'Last Name'))
  const email = nonEmpty(pickField(body, 'Email'))
  const phone = nonEmpty(pickField(body, 'Phone'))
  const message = nonEmpty(pickField(body, 'Message'))
  const opt_in = coerceOptIn(pickField(body, 'Opt In for Messaging'))
  const location = parseLocation(form_name)

  return {
    form_id,
    form_name,
    location,
    first_name,
    last_name,
    email,
    phone,
    message,
    opt_in,
    raw: body,
  }
}

module.exports = {
  parseWebsiteFormBody,
  parseLocation,
  KNOWN_LOCATIONS,
}
