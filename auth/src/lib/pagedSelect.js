// auth/src/lib/pagedSelect.js
// Read every row a Supabase/PostgREST query returns, past the server's
// 1,000-row reply cap. Each page is a fresh query from `build()` with a stable
// `order` and a `.range()`, read until a short page. Throws on any page error
// (never a silent partial set). Pure apart from the client passed in, so the
// tests drive it with a fake.
const PAGE = 1000
const CHUNK = 150

/**
 * build: () => query builder (not awaited, no .range()).
 * order: columns that make the order stable, e.g. ['id'].
 * maxRows: stop once this many rows are read (a safety bound).
 */
async function selectAllPages(build, { order = [], pageSize = PAGE, maxRows = Infinity, ascending = true } = {}) {
  const out = []
  for (let from = 0; out.length < maxRows; from += pageSize) {
    let query = build()
    for (const col of order) query = query.order(col, { ascending })
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out.length > maxRows ? out.slice(0, maxRows) : out
}

/**
 * `.in(column, values)` over any number of values: chunks the list so the URL
 * stays short, and pages each chunk. `extend(q)` adds filters to every page.
 */
async function selectInPaged(client, table, cols, column, values, { extend = (q) => q, chunk = CHUNK, ...paging } = {}) {
  const list = [...new Set(values || [])].filter(v => v != null && v !== '')
  const out = []
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk)
    out.push(...await selectAllPages(() => extend(client.from(table).select(cols).in(column, part)), paging))
  }
  return out
}

module.exports = { selectAllPages, selectInPaged, PAGE }
