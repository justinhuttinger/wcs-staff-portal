// Every word typed must appear somewhere in the name or department, so
// "sam group" finds "Sam Rivera (Group Exercise)" and a surname alone works too.
// Order is kept as given (the server sends Group Exercise first, then A-Z).
export function filterInstructors(instructors, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return instructors
  return instructors.filter(i => {
    const hay = `${i.display_name || ''} ${i.department || ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}
