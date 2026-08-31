import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// One Back, in one place, in every theme.
//
// Source-text assertions because this is CSS behaviour: nothing a unit test can
// render, and both failure modes are silent. Re-scoping the rule to a theme
// brings back the double buttons on Tickets, Reporting and Till without
// breaking anything that would fail; tagging an inner back hides the only way
// up from a sub-view.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '..', 'index.css'), 'utf8')
const hub = readFileSync(join(here, 'groupx', 'GroupXHub.jsx'), 'utf8')

test('the redundant-back rule applies to every theme', () => {
  assert.match(css, /^\.redundant-back \{ display: none !important; \}/m)
  // A theme-scoped version is the regression: Classic would show a view's own
  // back-to-portal button alongside the header's, which is what this fixed.
  assert.doesNotMatch(css, /\[data-theme=[^\]]*\]\s*\.redundant-back/)
})

test('the Group X hub keeps the back that steps within it', () => {
  // Two back controls in this file: "Group X" returns to the hub's cards and
  // must stay visible; "Back" leaves for the portal and is hidden.
  const inner = hub.slice(hub.indexOf('setSection(null)'))
  const innerButton = inner.slice(0, inner.indexOf('</button>'))
  assert.ok(
    !innerButton.includes('redundant-back'),
    'the hub-level back must stay visible, or a sub-view has no way up',
  )
  assert.match(hub, /onClick=\{onBack\}[^>]*redundant-back/s)
})
