import { api } from '../../lib/api'

const query = (params) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') s.set(k, v)
  }
  return s.toString()
}
const json = (method, body) => ({ method, body: JSON.stringify(body || {}) })

// /coaching: programs and templates (one tree), and a client's workout log.
export const coachingApi = {
  listTemplates: (params) => api(`/coaching/programs?${query({ kind: 'template', ...params })}`),
  listClientPrograms: (member) => api(`/coaching/programs?${query({
    kind: 'client', member_id: member.member_id, club_number: member.club_number,
  })}`),
  getProgram: (id) => api(`/coaching/programs/${id}`),
  createProgram: (body) => api('/coaching/programs', json('POST', body)),
  saveProgram: (id, body) => api(`/coaching/programs/${id}`, json('PUT', body)),
  copyProgram: (id, body) => api(`/coaching/programs/${id}/copy`, json('POST', body)),
  publishProgram: (id) => api(`/coaching/programs/${id}/publish`, json('POST')),
  patchProgram: (id, body) => api(`/coaching/programs/${id}`, json('PATCH', body)),
  deleteProgram: (id) => api(`/coaching/programs/${id}`, { method: 'DELETE' }),
  listSessions: (member, limit = 30) => api(`/coaching/sessions?${query({
    member_id: member.member_id, club_number: member.club_number, limit,
  })}`),
}

// /exercises: the library behind the picker.
export const exercisesApi = {
  search: (params) => api(`/exercises?${query(params)}`),
  facets: () => api('/exercises/facets'),
  get: (id) => api(`/exercises/${id}`),
  // 503 = no playable video yet (free images, or YMove key not set).
  video: (id) => api(`/exercises/${id}/video`),
  create: (body) => api('/exercises', json('POST', body)),
}
