const api = window.pagerLockIPC
const pw = document.getElementById('pw')
const error = document.getElementById('error')

api.action().then((action) => {
  document.getElementById('label').textContent = `Enter the call button password to ${action}.`
})

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const res = await api.tryPassword(pw.value)
  if (res && res.ok) return
  error.textContent = (res && res.error) || 'Wrong password'
  pw.value = ''
  pw.focus()
})
