// Pure helpers for the task editor (unit-tested in taskForm.test.mjs).

export function statusOptions() {
  return [
    { value: 'todo', label: 'To do' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'done', label: 'Done' },
    { value: 'dropped', label: 'Dropped' },
  ]
}

// Enter in the title saves, but never twice while a save is running.
export function canSubmitOnEnter({ key, title, saving }) {
  return key === 'Enter' && !saving && String(title || '').trim().length > 0
}
