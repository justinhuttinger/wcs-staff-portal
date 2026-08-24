// auth/src/services/meetingGoals/processes.js
// Which Operandio processes are meeting jobs, resolved by their CURRENT name.
//
// Why this exists: operandio_api_jobs.process_name is a snapshot taken when the
// job instance was created, so renaming a process in Operandio leaves every
// existing job carrying the OLD name. That bit us for real on 2026-08-24 — the
// MC/PT pair was renamed to fix crossed content, and the already-created job
// still reported the pre-rename name, which would have filed a PT action plan
// into the MC article. Process ids never change, so we key on those.
'use strict'

const { fetchProcesses } = require('../../lib/operandioApi')
const { kindForProcess } = require('./extract')

// Map of process id -> 'MC' | 'PT', built from live names. Also covers the
// per-club copies for free: every club's "PT Weekly Meeting" resolves to PT
// whatever its id.
async function fetchProcessKinds() {
  const processes = await fetchProcesses()
  const byId = new Map()
  for (const p of processes) {
    if (!p || !p.id) continue
    const kind = kindForProcess(p.name)
    if (kind) byId.set(p.id, kind)
  }
  return byId
}

module.exports = { fetchProcessKinds }
