// Who gets a Google Chat DM for a Projects task event, and what it says.
// Pure: the sender (services/projects/notify.js) does the I/O.
//
// Events:
//   assigned  -> the newly added assignees
//   comment   -> every assignee ("commented"), plus any member @mentioned
//                who is not assigned ("mentioned you")
//   complete  -> every assignee
// The actor never gets their own event.

const { toPlainText, parseMentionIds } = require('../ticketMentions')

const PORTAL_URL = process.env.PORTAL_BASE_URL || process.env.PORTAL_URL || 'https://portal.wcstrength.com'
const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const COMMENT_MAX = 1500

function taskLink(taskId, base = PORTAL_URL) {
  return `${String(base).replace(/\/+$/, '')}/?task=${taskId}`
}

function dueText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null
}

function excerpt(body) {
  const text = toPlainText(body || '').trim()
  return text.length > COMMENT_MAX ? text.slice(0, COMMENT_MAX - 1) + '…' : text
}

// Google Chat renders <url|label> as a link.
function compose(kind, { task, actorName, commentBody, base }) {
  const who = actorName || 'Someone'
  const title = `"${task.title}"`
  const link = `<${taskLink(task.id, base)}|Open task>`
  if (kind === 'assigned') {
    const bits = [PRIORITY_LABEL[task.priority], task.due_date ? `due ${dueText(task.due_date)}` : null].filter(Boolean)
    return `${who} assigned you ${title}${bits.length ? ` · ${bits.join(' · ')}` : ''}\n${link}`
  }
  if (kind === 'comment') return `${who} commented on ${title}:\n${excerpt(commentBody)}\n${link}`
  if (kind === 'mentioned') return `${who} mentioned you on ${title}:\n${excerpt(commentBody)}\n${link}`
  if (kind === 'complete') return `${who} marked ${title} complete\n${link}`
  return `${who} updated ${title}\n${link}`
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

// Returns [{ targetId, kind, text }], one per person, actor excluded.
function planNotifications({ event, task, actorId, actorName, added = [], commentBody, memberIds = [], base }) {
  const assignees = (task.assignees || []).map(a => a.staff_id)
  const out = new Map()
  const add = (id, kind) => {
    if (!id || same(id, actorId) || out.has(String(id).toLowerCase())) return
    out.set(String(id).toLowerCase(), { targetId: id, kind })
  }

  if (event === 'assigned') added.forEach(id => add(id, 'assigned'))
  if (event === 'complete') assignees.forEach(id => add(id, 'complete'))
  if (event === 'comment') {
    assignees.forEach(id => add(id, 'comment'))
    const members = new Set(memberIds.map(id => String(id).toLowerCase()))
    parseMentionIds(commentBody).filter(id => members.has(id)).forEach(id => {
      const match = memberIds.find(m => same(m, id))
      add(match, 'mentioned')
    })
  }

  return [...out.values()].map(r => ({ ...r, text: compose(r.kind, { task, actorName, commentBody, base }) }))
}

module.exports = { planNotifications, compose, taskLink, dueText }
