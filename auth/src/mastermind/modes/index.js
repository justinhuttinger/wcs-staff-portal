// v2 mode handler registry. Two user-triggerable modes (strategize, build)
// plus the @mastermind comment-mention iteration (continue). Older modes
// (brief_me, analyze, draft, review, wrap_up) were collapsed into strategize
// and build per Justin's request to simplify the dropdown UX.
const HANDLERS = {
  strategize: require('./strategize'),
  build: require('./build'),
  continue: require('./continue'),
}

function getHandler(mode) {
  return HANDLERS[mode] || null
}

module.exports = { getHandler, HANDLERS }
