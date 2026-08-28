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
    skipReason
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

// Every process (template) with its CURRENT name. Job rows carry a
// denormalized `processName` snapshot taken when the instance was created, so
// after a rename in Operandio that snapshot is stale — anything that must
// follow the current name has to resolve process id -> name through here.
async function fetchProcesses() {
  const pageSize = 100
  const out = []
  for (let offset = 0; ; offset += pageSize) {
    const data = await graphql(
      `query($limit: Int, $offset: Int) {
        processes { list(filter: {}, limit: $limit, offset: $offset) { id name inactive } }
      }`,
      { limit: pageSize, offset },
    )
    const page = data.processes?.list || []
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
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

// ---------------------------------------------------------------------------
// Knowledge articles.
//
// `richTextContent` is a TipTap doc; on INPUT the field is `tipTapContent`, on
// OUTPUT `richTextContent`. (Full schema notes in reference_operandio_api.)
//
// There are two ways to republish, and which you want depends on whether the
// article's id has to survive:
//
//   updateKnowledgeArticle() — edits IN PLACE via the undocumented
//     `Mutation.knowledge` NAMESPACE: knowledge(id){ update(input) }. There is
//     no `updateKnowledgeV2`; that name does not exist, which is why this
//     looked impossible for a while. Keeps the id, so anything linking to the
//     article (e.g. an Operandio job's `@[Title](KnowledgeArticle:<id>)` step)
//     keeps working. Omitted input fields are PRESERVED, so we send only
//     type/title/tipTapContent and never disturb the category, groups, or
//     locations set in the Operandio UI. Note it creates NO version — there is
//     no API-side undo, so callers must be able to rebuild content from their
//     own source of truth.
//
//   createKnowledgeArticle() + deleteKnowledge() — create-before-delete. The id
//     CHANGES every run, so callers must look articles up by title, never by a
//     stored id, and nothing may link to the article by id. Used by the KPI
//     digest, which predates the discovery of the update mutation.

// All KnowledgeArticle items with id + title (files are ignored). Used to find
// the current digest article to supersede.
async function listKnowledgeArticles() {
  const data = await graphql(
    `query { knowledges { ... on KnowledgeArticle { id title } } }`,
  )
  return (data.knowledges || []).filter((k) => k && k.id)
}

// Create a rich-text article. `tipTapContent` is a TipTap doc object.
async function createKnowledgeArticle({ title, category, groups = [], tipTapContent }) {
  const data = await graphql(
    `mutation ($input: KnowledgeInput!) {
      createKnowledgeV2(input: $input) {
        ... on KnowledgeArticle { id title richTextContent createdAt }
      }
    }`,
    { input: { type: 'article', title, category, groups, tipTapContent } },
  )
  return data.createKnowledgeV2
}

// Edit an article in place, keeping its id. Only the fields passed are changed;
// everything omitted (category, groups, locations, tags) is preserved by the
// API, so callers do not need to know them. `title` is required by
// KnowledgeInput even when unchanged — pass the article's existing title or it
// gets renamed.
async function updateKnowledgeArticle({ id, title, tipTapContent }) {
  const data = await graphql(
    `mutation ($id: ID!, $input: KnowledgeInput!) {
      knowledge(id: $id) {
        update(input: $input) {
          ... on KnowledgeArticle { id title richTextContent }
        }
      }
    }`,
    { id, input: { type: 'article', title, tipTapContent } },
  )
  return data.knowledge?.update
}

// Fetch one article's stored richTextContent (for post-write verification).
async function fetchKnowledgeContent(id) {
  const data = await graphql(
    `query { knowledges { ... on KnowledgeArticle { id richTextContent } } }`,
  )
  const hit = (data.knowledges || []).find((k) => k && k.id === id)
  return hit ? hit.richTextContent : null
}

async function deleteKnowledge(id) {
  const data = await graphql(`mutation ($id: ID!) { deleteKnowledge(id: $id) }`, { id })
  return data.deleteKnowledge === true
}


// ---------------------------------------------------------------------------
// Shifts — who was actually working over a window.
//
// THERE IS NO endsAt FILTER. ShiftsFilterInput offers startsAtFrom /
// startsAtTo and nothing else, so a shift running 11:00-19:00 is invisible to a
// query windowed on 15:00. The window is therefore widened BACKWARDS by a full
// lookback and the end is filtered here, client-side.
//
// status: 'published' is not optional. Keizer mirrors every shift as a draft
// twin and Salem has drafts naming different people than the published row, so
// including drafts both double-counts and misattributes.
//
// Timestamps go out as ISO strings carrying an explicit offset. A bare local
// string is interpreted by the server, and "which server, which zone" is not a
// question worth betting an attribution on.
// ---------------------------------------------------------------------------

// The hard ceiling on a shift is absoluteMaxShiftLengthMinutes = 2880 (48h).
// 24h covers anything realistic at a gym; the constant is here so the reason for
// the number is not lost.
const SHIFT_LOOKBACK_HOURS = 24

const SHIFT_FIELDS = `
  id
  startsAt
  endsAt
  status
  user { id firstName lastName }
  group { id name }
  location { id name timeZone }
`

/**
 * Every published shift overlapping [from, to] at one location.
 *
 * @param locationId Operandio location id
 * @param from       Date — start of the window of interest
 * @param to         Date — end of it
 * @returns [{ id, startsAt, endsAt, user, group }]
 */
async function fetchShiftsOverlapping(locationId, from, to) {
  const lookback = new Date(from.getTime() - SHIFT_LOOKBACK_HOURS * 3600 * 1000)

  const data = await graphql(
    `query WhoWasOn($filter: ShiftsFilterInput!) {
      shifts { list(filter: $filter, orderBy: "startsAt", limit: 500) { ${SHIFT_FIELDS} } }
    }`,
    {
      filter: {
        startsAtFrom: lookback.toISOString(),
        startsAtTo: to.toISOString(),
        locations: [locationId],
        status: 'published',
      },
    }
  )

  const list = (data && data.shifts && data.shifts.list) || []
  // The half of the window the server could not filter on: drop shifts that had
  // already ended before the window opened.
  return list.filter(sh => sh.endsAt && new Date(sh.endsAt) > from)
}

module.exports = {
  graphql, getToken, scheduleDate, fetchLocations, fetchJobs, fetchProcesses,
  fetchShiftsOverlapping, SHIFT_LOOKBACK_HOURS,
  fetchJobStepDetail,
  listKnowledgeArticles, createKnowledgeArticle, updateKnowledgeArticle,
  fetchKnowledgeContent, deleteKnowledge,
}
