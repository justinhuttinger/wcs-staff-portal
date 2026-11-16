// State changes for a person attached to a Hub task. Pure; unit-tested.

// A reply newer than the last one we saw: the person is "replied" and the
// owner has not looked yet. Anything else changes nothing.
function applyReply(person, reply) {
  if (!reply) return null
  const seen = person.last_reply_at ? new Date(person.last_reply_at).getTime() : 0
  if (!(reply.at > seen)) return null
  return {
    state: 'replied',
    last_reply_at: new Date(reply.at).toISOString(),
    last_reply_snippet: String(reply.snippet || '').slice(0, 500),
    reply_seen: false,
  }
}

function afterSend(person, now) {
  return { state: 'waiting', last_sent_at: now }
}

// The first email from a to-do task means the owner is now waiting on someone.
function taskStatusAfterSend(status) {
  return status === 'todo' ? 'waiting' : status
}

module.exports = { applyReply, afterSend, taskStatusAfterSend }
