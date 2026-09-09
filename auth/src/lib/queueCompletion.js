// What the tour queue requires before it will complete a card.
//
// The sibling of tourCompletion.js, which guards the /tours/complete API. That
// route has always demanded a name for whoever gave the tour; the queue never
// did, so an iPad could save a completed trial with nobody attached to it and
// the row reached the reports and the outbound webhook that way. Salesperson
// Performance cannot attribute a tour it has no name for.
//
// Kept out of the route so it can be tested without standing up express and a
// Supabase stub.

/**
 * @param {{outcome?: string, tourMember?: string, cancelled?: boolean}} answers
 * @param {string[]} allowedOutcomes
 * @returns {{error: string} | null} the first problem, or null when it may save
 */
function queueCompletionError({ outcome, tourMember, cancelled } = {}, allowedOutcomes = []) {
  // A cancelled card is somebody who left before being seen. There is no
  // outcome and no tour to credit, so neither rule applies.
  if (cancelled) return null

  if (!allowedOutcomes.includes(outcome)) return { error: 'invalid outcome' }

  // Whitespace is not a name. A select cannot produce it, but this route is
  // reachable with anything by anyone holding the location's token.
  if (!String(tourMember || '').trim()) return { error: 'tour member is required' }

  return null
}

module.exports = { queueCompletionError }
