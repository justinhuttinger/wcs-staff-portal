// Stable per-machine identifier for the install registry.
//
// Generated once and persisted in config.json (alongside location/abc_url), so
// it survives restarts and app updates. Keyed on this rather than hostname so a
// machine rename doesn't create a duplicate registry row.

const crypto = require('crypto')
const os = require('os')
const { readConfig, writeConfig } = require('./config')

function getInstallId() {
  const cfg = readConfig()
  if (cfg && cfg.install_id) return cfg.install_id
  const id = crypto.randomUUID()
  writeConfig({ ...cfg, install_id: id })
  return id
}

function getHostname() {
  try { return os.hostname() } catch { return null }
}

module.exports = { getInstallId, getHostname }
