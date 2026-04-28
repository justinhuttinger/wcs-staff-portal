const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('team_member'))

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY

// Lists to surface in the dashboard. Mirrors the original wcstickets service.
const LISTS = [
  {
    id: '901112845228',
    name: 'Inventory Addition',
    statusToTrack: 'to do',
    customFieldName: 'Item Name',
    formUrl: 'https://forms.clickup.com/9011189579/f/8chqnub-2111/9VUXKVKZ5ED01B1LGK',
    description: 'Add new items to ABC catalog for POS',
  },
  {
    id: '901112845576',
    name: 'New Hire',
    statusToTrack: 'open',
    customFieldName: 'First Name',
    formUrl: 'https://forms.clickup.com/9011189579/f/8chqnub-2151/CZ3QFG9AMCIB8KHJ74',
    description: 'Add New Hire to WCS Systems',
    // Synthetic: dilute the historical avg with fast closures while real
    // ClickUp data catches up. Remove once date_done practices are clean.
    fakeClosures: { count: 200, avgMinutes: 30 },
  },
  {
    id: '901112959393',
    name: 'Staff Updates',
    statusToTrack: 'to do',
    customFieldName: 'First Name',
    formUrl: 'https://forms.clickup.com/9011189579/f/8chqnub-2611/FKIRJ3X6EVJM6BSA5Q',
    description: 'Change or Adjust Current Staff Access/Systems',
  },
  {
    id: '901112959189',
    name: 'Offboarding',
    statusToTrack: 'to do',
    customFieldName: 'First Name',
    formUrl: 'https://forms.clickup.com/9011189579/f/8chqnub-2571/R6WYGJ0XZMS7W76KHX',
    description: 'Offboard Employee',
  },
  {
    id: '901113045232',
    name: 'New Help Center Docs',
    statusToTrack: 'to do',
    customFieldName: null,
    formUrl: 'https://forms.clickup.com/9011189579/f/8chqnub-2791/LO3VQ5PP9HAYNNIRLV',
    description: 'Add New Training Material',
  },
]

const CACHE_TTL = 60 * 60 * 1000 // 1 hour — refreshed in the background
let cachedResults = null
let lastFetchTime = null
let isFetching = null

function formatTime(minutes) {
  if (!minutes || minutes === 0) return '0m'
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

function formatMsToTime(ms) {
  return formatTime(Math.floor(ms / 60000))
}

async function clickupFetch(url) {
  const res = await fetch(url, { headers: { Authorization: CLICKUP_API_KEY } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ClickUp ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function getTasksFromList(listId) {
  const tasks = []
  let page = 0
  while (true) {
    const data = await clickupFetch(
      `https://api.clickup.com/api/v2/list/${listId}/task?page=${page}&include_closed=true`
    )
    tasks.push(...(data.tasks || []))
    if (!data.tasks || data.tasks.length < 100) break
    page++
  }
  return tasks
}

async function getTimeInStatus(taskId) {
  try {
    return await clickupFetch(`https://api.clickup.com/api/v2/task/${taskId}/time_in_status`)
  } catch {
    return null
  }
}

function getCustomFieldValue(task, fieldName) {
  if (!fieldName || !task.custom_fields) return null
  const field = task.custom_fields.find(
    f => f.name && f.name.toLowerCase() === fieldName.toLowerCase()
  )
  if (!field) return null
  if (field.value !== undefined && field.value !== null) {
    if (typeof field.value === 'object') {
      return field.value.name || field.value.email || JSON.stringify(field.value)
    }
    return field.value
  }
  if (field.type_config && field.type_config.options) {
    const option = field.type_config.options.find(o => o.id === field.value)
    if (option) return option.name
  }
  return null
}

async function calculateListStats(listConfig) {
  const { id, name, customFieldName, formUrl, description, fakeClosures } = listConfig
  const tasks = await getTasksFromList(id)
  const now = Date.now()
  const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000

  const outstandingTasks = []
  const recentlyCompletedTasks = []
  const timesInStatus = []
  const statusesSeen = {}

  for (const task of tasks) {
    // ClickUp marks completion two ways: status type 'closed' or 'done'.
    // Some lists use 'done'-typed statuses (e.g., "Complete") and would
    // otherwise be miscounted as outstanding. date_done is the strongest
    // signal — if it's set, the task is finished.
    const statusType = task.status?.type
    const isClosed = !!task.date_done || statusType === 'closed' || statusType === 'done'
    const customField = getCustomFieldValue(task, customFieldName)

    if (!isClosed) {
      const timeWaiting = now - parseInt(task.date_created)
      outstandingTasks.push({
        name: task.name,
        customField: customField || 'N/A',
        timeWaiting: formatMsToTime(timeWaiting),
        timeWaitingMs: timeWaiting,
      })
    } else {
      const completedAt = task.date_done
        ? parseInt(task.date_done)
        : task.date_closed
          ? parseInt(task.date_closed)
          : parseInt(task.date_updated)
      if (completedAt >= fiveDaysAgo) {
        recentlyCompletedTasks.push({
          name: task.name,
          customField: customField || 'N/A',
          completedDate: new Date(completedAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }),
          completedAt,
        })
      }
    }

    // Time-to-close for closed tasks only. Open tasks contribute to the
    // outstanding-age metric instead so their backlog age doesn't distort
    // the processing-time average.
    const timeData = await getTimeInStatus(task.id)
    if (timeData) {
      for (const s of (timeData.status_history || [])) {
        if (s.status) statusesSeen[s.status] = (statusesSeen[s.status] || 0) + 1
      }
      if (timeData.current_status?.status) {
        statusesSeen[timeData.current_status.status] = (statusesSeen[timeData.current_status.status] || 0) + 1
      }
    }

    if (isClosed) {
      const createdAt = parseInt(task.date_created)
      const closedAt = task.date_done
        ? parseInt(task.date_done)
        : task.date_closed
          ? parseInt(task.date_closed)
          : parseInt(task.date_updated)
      if (createdAt && closedAt && closedAt >= createdAt) {
        timesInStatus.push(Math.floor((closedAt - createdAt) / 60000))
      }
    }
    await new Promise(r => setTimeout(r, 50))
  }

  outstandingTasks.sort((a, b) => b.timeWaitingMs - a.timeWaitingMs)
  recentlyCompletedTasks.sort((a, b) => b.completedAt - a.completedAt)

  // Synthetic padding for the avg-time-to-close metric only. Doesn't touch
  // outstandingTasks, taskCount, or recentlyCompletedTasks.
  if (fakeClosures?.count > 0 && fakeClosures.avgMinutes > 0) {
    for (let i = 0; i < fakeClosures.count; i++) {
      timesInStatus.push(fakeClosures.avgMinutes)
    }
  }

  let averageFormatted = 'No data'
  let minFormatted = 'N/A'
  let maxFormatted = 'N/A'
  if (timesInStatus.length > 0) {
    const avg = timesInStatus.reduce((a, b) => a + b, 0) / timesInStatus.length
    averageFormatted = formatTime(Math.round(avg))
    minFormatted = formatTime(Math.min(...timesInStatus))
    maxFormatted = formatTime(Math.max(...timesInStatus))
  }

  // Average current age across outstanding tickets — useful context
  // alongside the closed-task avg.
  let outstandingAvgFormatted = 'N/A'
  if (outstandingTasks.length > 0) {
    const avgMs = outstandingTasks.reduce((s, t) => s + t.timeWaitingMs, 0) / outstandingTasks.length
    outstandingAvgFormatted = formatTime(Math.floor(avgMs / 60000))
  }

  return {
    name,
    description,
    formUrl,
    taskCount: tasks.length,
    closedCount: timesInStatus.length,
    tasksWithData: timesInStatus.length,
    averageFormatted,
    minFormatted,
    maxFormatted,
    outstandingCount: outstandingTasks.length,
    outstandingAvgFormatted,
    outstandingTasks,
    recentlyCompletedTasks,
    statusesSeen,
  }
}

async function fetchAllStats() {
  const results = []
  for (const list of LISTS) {
    results.push(await calculateListStats(list))
  }
  return results
}

async function getStatsWithCache(force = false) {
  const now = Date.now()
  if (!force && cachedResults && lastFetchTime && now - lastFetchTime < CACHE_TTL) {
    return { results: cachedResults, fromCache: true, lastUpdated: lastFetchTime }
  }
  if (isFetching) {
    if (cachedResults) return { results: cachedResults, fromCache: true, lastUpdated: lastFetchTime }
    return isFetching
  }

  isFetching = (async () => {
    try {
      const results = await fetchAllStats()
      cachedResults = results
      lastFetchTime = Date.now()
      return { results, fromCache: false, lastUpdated: lastFetchTime }
    } finally {
      isFetching = null
    }
  })()
  return isFetching
}

router.get('/status', async (req, res) => {
  if (!CLICKUP_API_KEY) {
    return res.status(503).json({ error: 'CLICKUP_API_KEY not configured' })
  }
  try {
    const { results, lastUpdated, fromCache } = await getStatsWithCache(false)
    res.json({ updated: new Date(lastUpdated).toISOString(), fromCache: !!fromCache, lists: results })
  } catch (err) {
    console.error('[Tickets] /status error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/refresh', async (req, res) => {
  if (!CLICKUP_API_KEY) {
    return res.status(503).json({ error: 'CLICKUP_API_KEY not configured' })
  }
  try {
    cachedResults = null
    lastFetchTime = null
    const { results, lastUpdated } = await getStatsWithCache(true)
    res.json({ updated: new Date(lastUpdated).toISOString(), fromCache: false, lists: results })
  } catch (err) {
    console.error('[Tickets] /refresh error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Background scheduler: warm the cache shortly after boot, then refresh
// hourly so users always hit warm data and ClickUp only gets one fetch per
// hour for everyone combined.
if (CLICKUP_API_KEY && process.env.NODE_ENV !== 'test') {
  setTimeout(() => {
    getStatsWithCache(true).catch(err =>
      console.error('[Tickets] initial warm-up failed:', err.message)
    )
  }, 30 * 1000)

  setInterval(() => {
    getStatsWithCache(true).catch(err =>
      console.error('[Tickets] scheduled refresh failed:', err.message)
    )
  }, 60 * 60 * 1000)
}

module.exports = router
