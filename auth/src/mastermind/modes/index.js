// Mode handler registry. Each handler returns:
//   { commentText, docName?, docContent?, statusAfter?, lane?, usage }
const HANDLERS = {
  draft: require('./draft'),
  brief_me: require('./briefMe'),
  strategize: require('./strategize'),
  analyze: require('./analyze'),
  review: require('./review'),
  wrap_up: require('./wrapUp'),
  continue: require('./continue'),
}

function getHandler(mode) {
  return HANDLERS[mode] || null
}

module.exports = { getHandler, HANDLERS }
