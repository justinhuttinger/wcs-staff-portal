// Operandio GraphQL API client.
//
// Auth: OAuth 2.0 client-credentials against /auth/oauth2/token using an
// Operandio app-user login (OPERANDIO_API_EMAIL / OPERANDIO_API_PASSWORD).
// The JWT inherits that user's permission level and expires in ~30 minutes;
// we cache it and refresh 2 minutes early (or on a 401).
//
// Docs: https://developer.operandio.com/ (basic-auth gated). Gotchas learned
// the hard way:
//   - jobsV2.listAll REQUIRES an explicit offset (null -> Mongo $skip crash).
//   - ScheduleDateRangeInput is { start, end }, but the report* queries take
//     separate gt/lt args instead.
//   - Dates in/out of the API are org-local calendar days (Pacific for WCS).

const BASE_URL = process.env.OPERANDIO_API_BASE || 'https://api.operandio.com'

let cachedToken = null // { token, expiresAt (ms epoch) }

function credentials() {
  const email = process.env.OPERANDIO_API_EMAIL
  const password = process.env.OPERANDIO_API_PASSWORD
  if (!email || !password) {
    throw new Error('OPERANDIO_API_EMAIL / OPERANDIO_API_PASSWORD not configured')
  }
  return { email, password }
}

async function fetchToken() {
  const { email, password } = credentials()
  const res = await fetch(`${BASE_URL}/auth/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(`Operandio token request failed (${res.status}): ${body.error || 'no access_token'}`)
  }
  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in || 1800) * 1000 - 120000,
  }
  return cachedToken.token
}

async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token
  return fetchToken()
}

async function graphql(query, variables = {}, { retry = true } = {}) {
  const token = await getToken()
  const res = await fetch(`${BASE_URL}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 401 && retry) {
    cachedToken = null
    return graphql(query, variables, { retry: false })
  }
  const body = await res.json().catch(() => null)
  if (!res.ok || !body) throw new Error(`Operandio GraphQL HTTP ${res.status}`)
  if (body.errors && body.errors.length) {
    throw new Error('Operandio GraphQL error: ' + body.errors.map(e => e.message).join('; '))
  }
  return body.data
}

// A ScheduleDateInput from a JS Date interpreted in Pacific time (Operandio
// treats these as org-local calendar dates).
function scheduleDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(date)
  const get = t => Number(parts.find(p => p.type === t).value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

async function fetchLocations() {
  const data = await graphql(`query { locations { id name timeZone inactive } }`)
  return data.locations || []
}

const JOB_FIELDS = `
  id
  processName
  displayName
  scheduleName
  adhoc
  hasSubmit
  hasScoring
  percentComplete
  availableFrom
  dueAt
  process { id name }
  users { fullName }
  groups { name }
  status {
    completed
    completedAt
    completedBy { fullName }
    submitted
    submittedAt
    submittedBy { fullName }
    startedAt
    endedAt
    failed
    score
    possibleScore
  }
`

// All job instances due in [start, end] (org-local days, inclusive) for one
// Operandio location. Pages through listAll.
async function fetchJobs(locationId, startDate, endDate) {
  const filter = {
    locations: [locationId],
    dateRange: { start: scheduleDate(startDate), end: scheduleDate(endDate) },
  }
  const pageSize = 100
  const jobs = []
  for (let offset = 0; ; offset += pageSize) {
    const data = await graphql(
      `query($f: JobsQueryAllFilterInput!, $limit: Int, $offset: Int) {
        jobsV2 { listAll(filter: $f, limit: $limit, offset: $offset) { ${JOB_FIELDS} } }
      }`,
      { f: filter, limit: pageSize, offset },
    )
    const page = data.jobsV2?.listAll || []
    jobs.push(...page)
    if (page.length < pageSize) break
  }
  return jobs
}

// Flattened per-step responses for every instance of one process at one
// location in [gt, lt] (org-local days). This is the step-level who/when.
async function fetchJobStepDetail(processId, locationId, startDate, endDate) {
  const data = await graphql(
    `query($p: ID!, $l: ID!, $gt: ScheduleDateInput!, $lt: ScheduleDateInput) {
      reportJobDetail(process: $p, location: $l, gt: $gt, lt: $lt) {
        jobs {
          id
          dueAt
          steps {
            id
            step
            name
            responseType
            response
            skip
            completedAt
            completedByFullName
            score
            possibleScore
            failed
            notes { text author { fullName } createdAt }
          }
        }
      }
    }`,
    { p: processId, l: locationId, gt: scheduleDate(startDate), lt: scheduleDate(endDate) },
  )
  return data.reportJobDetail?.jobs || []
}

module.exports = { graphql, getToken, scheduleDate, fetchLocations, fetchJobs, fetchJobStepDetail }
