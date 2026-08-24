// auth/src/services/childcare/processes.js
// Which Operandio processes are childcare checklists, resolved by CURRENT name.
//
// operandio_api_jobs.process_name is a snapshot from job-creation time and goes
// stale the moment a process is renamed — that misfiled a live submission on
// 2026-08-24 in the meeting goals service. Process ids never change, so we map
// id -> block and select jobs by id.
//
// Resolving by name also means rollout needs no code change: these are single
// processes with locations added to them, so a new club just starts appearing.
'use strict'

const { fetchProcesses } = require('../../lib/operandioApi')
const { BLOCKS } = require('./config')

const TTL_MS = 10 * 60 * 1000
let cache = null // { at, map }

// Map of process id -> 'morning' | 'evening'. Cached briefly: the report is
// interactive and the process list changes about never.
async function fetchBlockByProcessId({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.map
  const processes = await fetchProcesses()
  const map = new Map()
  for (const p of processes) {
    if (!p || !p.id) continue
    const block = BLOCKS[String(p.name || '').trim().toLowerCase()]
    if (block) map.set(p.id, block)
  }
  cache = { at: Date.now(), map }
  return map
}

function clearCache() { cache = null }

module.exports = { fetchBlockByProcessId, clearCache }
