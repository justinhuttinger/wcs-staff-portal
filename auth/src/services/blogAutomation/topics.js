// auth/src/services/blogAutomation/topics.js
const { CATEGORIES } = require('./config')

function resolveTopicText(topic, locationName) {
  return String(topic).replace(/\[Location\]/g, locationName)
}

// Least-recently-used: pick the first category not in recent; if all recent,
// pick the one used longest ago (front of the category list wins on ties).
function pickCategory(recentCategoryKeys = []) {
  const keys = CATEGORIES.map(c => c.key)
  const fresh = keys.find(k => !recentCategoryKeys.includes(k))
  if (fresh) return fresh
  // all used recently: choose the one whose last use is oldest
  let best = keys[0], bestIdx = -1
  for (const k of keys) {
    const idx = recentCategoryKeys.lastIndexOf(k) // larger = more recent
    if (idx > bestIdx) continue
    best = k; bestIdx = idx
  }
  return best
}

function pickTopic(categoryKey, recentTopics = [], locationName = '') {
  const cat = CATEGORIES.find(c => c.key === categoryKey) || CATEGORIES[0]
  const resolved = cat.topics.map(t => resolveTopicText(t, locationName))
  const fresh = resolved.find(t => !recentTopics.includes(t))
  return fresh || resolved[0]
}

module.exports = { pickCategory, pickTopic, resolveTopicText }
