function deriveLocation(segments) {
  return segments && segments.length ? segments[0] : null
}
function joinFolderPath(segments) {
  return (segments || []).join('/')
}
module.exports = { deriveLocation, joinFolderPath }
