// Saves what happened after Gmail accepted an email. The email is already
// gone, so this must never throw: a retry would send a duplicate and, for a
// first email, start a second thread. The thread ids go on the person first,
// in one write; anything that fails comes back as a warning.
const { afterSend, taskStatusAfterSend } = require('./personState')

async function recordSend({ db, person, task, sent, kind, subject, body, now }) {
  const newThread = !person.gmail_thread_id
  const failures = []

  const patch = { ...afterSend(person, now) }
  if (newThread) {
    patch.subject = subject
    patch.gmail_thread_id = sent.threadId
    patch.first_message_id_header = sent.messageIdHeader || null
  }
  let saved = null
  try {
    const { data, error } = await db.updatePerson(person.id, patch)
    if (error) failures.push(`person: ${error.message}`)
    else saved = data
  } catch (e) { failures.push(`person: ${e.message}`) }

  // On an existing thread every email is a reply, whatever the client said.
  const storedKind = newThread ? (kind === 'nudge' ? 'initial' : kind) : (kind === 'initial' ? 'nudge' : kind)
  try {
    const { error } = await db.insertMessage({
      person_id: person.id, kind: storedKind, subject, body, gmail_message_id: sent.id, sent_at: now,
    })
    if (error) failures.push(`message: ${error.message}`)
  } catch (e) { failures.push(`message: ${e.message}`) }

  const taskStatus = taskStatusAfterSend(task.status)
  if (taskStatus !== task.status) {
    try {
      const { error } = await db.updateTask(task.id, { status: taskStatus, updated_at: now })
      if (error) failures.push(`task: ${error.message}`)
    } catch (e) { failures.push(`task: ${e.message}`) }
  }

  if (failures.length) {
    console.error('[Hub] email sent but not fully saved', { personId: person.id, messageId: sent.id, threadId: sent.threadId, failures })
  }
  return {
    person: saved || { ...person, ...patch },
    taskStatus,
    warning: failures.length
      ? "The email was sent, but the portal couldn't save it. Don't send it again; check the thread in Gmail."
      : null,
  }
}

module.exports = { recordSend }
