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

test('a GFM table renders as an HTML table, not raw pipes', () => {
  const md = [
    '| Owner | Commitment | Due |',
    '| --- | --- | --- |',
    '| Steve | Finish Operandio setup | This week |',
    '| **James** | Catering quote to Jon | Budget call |',
  ].join('\n')
  const html = markdownToHtml(md)
  assert.match(html, /<table>/)
  assert.match(html, /<th>Owner<\/th><th>Commitment<\/th><th>Due<\/th>/)
  assert.match(html, /<td>Steve<\/td><td>Finish Operandio setup<\/td><td>This week<\/td>/)
  assert.match(html, /<td><strong>James<\/strong><\/td>/) // inline bold in a cell
  assert.match(html, /<\/table>/)
  assert.ok(!html.includes('|'), 'no raw pipes leak through')
})

test('a table followed by a paragraph closes the table', () => {
  const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter the table.'
  const html = markdownToHtml(md)
  assert.match(html, /<\/table>\s*<p>After the table\.<\/p>/)
})

test('a lone pipe in prose is not treated as a table', () => {
  const html = markdownToHtml('Use A | B as a fallback.')
  assert.match(html, /<p>Use A \| B as a fallback\.<\/p>/)
  assert.ok(!html.includes('<table>'))
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
