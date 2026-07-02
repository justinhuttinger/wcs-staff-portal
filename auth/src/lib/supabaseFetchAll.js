// Fetch every row a PostgREST/Supabase query would return, transparently paging
// past the server's default 1000-row reply cap. Without this, `await query` (or
// a single `.range(0, 999)`) silently truncates: any report spanning enough
// rows drops the overflow, and because most report queries order ascending, the
// rows lost are often the newest — the exact ones a user opened the report to see.
//
// Pass a query builder that has NOT yet been awaited and has NO .range() applied.
// Throws on the first page error rather than returning a partial set, so callers
// surface a real failure instead of rendering silent zeros.
async function fetchAll(query, pageSize = 1000) {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

module.exports = { fetchAll }
