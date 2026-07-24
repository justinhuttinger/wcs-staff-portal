// auth/src/services/meetingNotes/markdown.test.js
const test = require('node:test')
const assert = require('node:assert')
const { markdownToHtml, escapeHtml } = require('./markdown')

test('headings map to h2/h3', () => {
  assert.match(markdownToHtml('## Overview'), /<h2>Overview<\/h2>/)
  assert.match(markdownToHtml('### Key Takeaways'), /<h3>Key Takeaways<\/h3>/)
})

test('bold is unwrapped inside content', () => {
  assert.match(markdownToHtml('**Steve**: do the thing'), /<strong>Steve<\/strong>: do the thing/)
})

test('plain bullets become a <ul>', () => {
  const html = markdownToHtml('*   First\n*   Second')
  assert.match(html, /<ul>\s*<li>First<\/li>\s*<li>Second<\/li>\s*<\/ul>/)
})

test('checkbox items render checked/unchecked boxes', () => {
  const html = markdownToHtml('- [ ] Todo item\n- [x] Done item')
  assert.match(html, /<li>☐ Todo item<\/li>/)
  assert.match(html, /<li>☑ Done item<\/li>/)
})

test('blank line closes a list and starts a paragraph', () => {
  const html = markdownToHtml('*   Bullet\n\nA paragraph.')
  assert.match(html, /<\/ul>\s*<p>A paragraph\.<\/p>/)
})

test('html-significant chars in content are escaped', () => {
  assert.strictEqual(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d')
  assert.match(markdownToHtml('5 < 10 & rising'), /5 &lt; 10 &amp; rising/)
})

test('a realistic notes block produces headings, checklist, and bullets', () => {
  const md = [
    '### Overview', '', 'Team met.', '',
    '### Next Steps', '', '- [ ] **Steve**: finish setup', '- [x] **Jon**: sent checklist', '',
    '### Key Topics', '', '*   Block Party at every location',
  ].join('\n')
  const html = markdownToHtml(md)
  assert.match(html, /<h3>Overview<\/h3>/)
  assert.match(html, /<h3>Next Steps<\/h3>/)
  assert.match(html, /<li>☐ <strong>Steve<\/strong>: finish setup<\/li>/)
  assert.match(html, /<li>☑ <strong>Jon<\/strong>: sent checklist<\/li>/)
  assert.match(html, /<li>Block Party at every location<\/li>/)
})
