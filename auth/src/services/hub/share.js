// What people submitted on a task, grouped by club, and the same as a text
// block the owner pastes into Claude (links instead of downloads). Pure;
// tested in tests/hubShare.test.js.

const first = name => String(name || '').split(' ')[0]

// deliverables: [{ id, name, kind, slots: [{ id, club, person_id, items: [{ id, file_name, text_body }] }] }]
function groupSubmissions({ deliverables, clubNames = {}, people = [], clubOrder = [], club = null }) {
  const byClub = new Map()
  for (const d of deliverables) {
    for (const s of d.slots || []) {
      const key = s.club ?? null
      // club 'none' = only slots without a club; any other value = that club.
      if (club === 'none' ? key !== null : (club && key !== club)) continue
      for (const it of s.items || []) {
        if (!byClub.has(key)) byClub.set(key, [])
        const person = people.find(p => p.id === s.person_id)?.name || ''
        byClub.get(key).push({
          id: it.id, deliverable: d.name, kind: d.kind, person,
          isFile: it.text_body == null, fileName: it.file_name || null, mime: it.mime || null, text: it.text_body ?? null,
          label: key ? `${clubNames[key] || key} ${d.name}` : d.name,
        })
      }
    }
  }
  const rank = c => (c === null ? -1 : (clubOrder.indexOf(c) === -1 ? 999 : clubOrder.indexOf(c)))
  return [...byClub.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([c, items]) => ({ club: c, clubName: c ? (clubNames[c] || c) : 'Submitted', items }))
}

function claudeBlock({ taskTitle, shareUrl, groups, fileUrl }) {
  const lines = [`${taskTitle} - submissions (share page: ${shareUrl})`]
  if (!groups.length) return [...lines, '', 'Nothing submitted yet.'].join('\n')
  for (const g of groups) {
    lines.push('', `## ${g.clubName}`)
    for (const i of g.items) {
      const who = i.person ? ` (${first(i.person)})` : ''
      lines.push(i.isFile ? `- ${i.deliverable}${who}: ${fileUrl(i.id)}` : `- ${i.deliverable}${who}: "${i.text}"`)
    }
  }
  return lines.join('\n')
}

module.exports = { groupSubmissions, claudeBlock }
