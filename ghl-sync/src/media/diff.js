function diffDriveVsDb(driveFiles, dbRows) {
  const byId = new Map(dbRows.map((r) => [r.drive_file_id, r]))
  const driveIds = new Set(driveFiles.map((f) => f.id))
  const toEmbed = driveFiles.filter((f) => {
    const row = byId.get(f.id)
    if (!row) return true // new
    if (f.md5 && row.md5) return f.md5 !== row.md5
    return String(f.modifiedTime) !== String(row.drive_modified_time) // md5 missing -> fall back
  })
  const toDelete = dbRows.filter((r) => !driveIds.has(r.drive_file_id))
  return { toEmbed, toDelete }
}
module.exports = { diffDriveVsDb }
