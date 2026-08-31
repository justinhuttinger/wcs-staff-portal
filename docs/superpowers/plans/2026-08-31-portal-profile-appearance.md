# Portal Profile & Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a profile page where they choose their theme, layout, density, accent and home background photo, and give admins a shared background gallery and an org-wide appearance default.

**Architecture:** The portal already has the whole appearance engine and its persistence. `lib/theme.js` writes `data-*` attributes onto `<html>` and `index.css` redefines tokens per theme; `auth/src/routes/uiPreferences.js` stores a per-user JSONB `prefs` blob; `lib/uiPrefs.js` hydrates it at login and pushes changes back, debounced, with localStorage as a pre-paint mirror. This plan therefore adds no persistence layer. It (a) lifts the existing admin-only picker into a page everyone can reach, (b) adds two keys to the existing prefs blob for the background, (c) adds one Express route backed by a private Supabase Storage bucket for uploads, and (d) adds an org default read from the existing `app_config` key-value store.

**Tech Stack:** React 19 + Vite 8 + Tailwind 4 (portal), Node 20 + Express + `@supabase/supabase-js` + multer (auth), Supabase Postgres + Storage. Tests are `node:test` + `node:assert/strict`. In `auth/`, `npm test` runs `node --test src/` and helpers live in a `*Helpers.js` beside a `*.test.js` (see `trainerAvailabilityHelpers.js`). In `portal/` there is no test script; pure-logic modules get a sibling `*.test.mjs` run with `node --test <path>`. **There is no DOM test environment, so no JSX is unit-tested** — components are verified by build plus manual check.

**Spec:** `docs/superpowers/specs/2026-08-31-portal-profile-appearance-design.md` (sections 2, 3, 4)

## Global Constraints

- **Three PRs, opened separately, never merged by the implementer.** PR A = Tasks 1-4, PR B = Tasks 5-10, PR C = Tasks 11-12. Each branches off `origin/master`, not off its predecessor, unless the predecessor has merged first. Once a PR is open its branch is frozen: follow-on work gets a new branch and a new PR.
- Prefs are stored in **one JSONB blob** at `user_ui_preferences.prefs`, capped at **4096 bytes** server-side. Never add a table or a column for a preference.
- The server **does not validate** pref values by design (`uiPreferences.js` says so, at length). All allow-lists and normalization live in `portal/src/lib/theme.js`. Do not duplicate them server-side.
- Every normalizer follows the existing rule in `theme.js`: an unknown, missing or out-of-range value **falls back to the default**, never throws and never renders unstyled.
- localStorage keys must stay in sync with the inline pre-paint script in `portal/index.html` (lines 14-27). Changing one without the other causes a flash of the wrong theme.
- Background defaults are `{ kind: 'location', value: '' }` and `backgroundDim: 60`. These reproduce today's behavior exactly: `60` is the current hardcoded `bg-black/60` at `App.jsx:540`.
- `staff_id` for any storage path comes from `req.staff.id` (the token), **never** from the request body.
- No em-dashes in user-facing copy.
- Migrations are applied by hand at merge. This plan adds none.

---

# PR A: Profile page and the appearance move

Branch: `git switch -c feat/portal-profile-view origin/master`

---

### Task 1: Extract the theme option tables and preview component

Today `AppearanceAdmin.jsx` owns the `OPTIONS` swatch table, the `LAYOUTS` and `DENSITIES` label tables, the `Preview` component and the `Segmented` control. The profile page needs all five. Each preview renders in its **own hardcoded colors** rather than live tokens, precisely so all four themes show side by side whatever theme is active, which means a copy-pasted duplicate would silently show the wrong swatches after any edit. Extract rather than duplicate.

This task is a pure move: no behavior changes.

**Files:**
- Create: `portal/src/components/appearance/themeOptions.js`
- Create: `portal/src/components/appearance/ThemePreview.jsx`
- Create: `portal/src/components/appearance/AppearanceControls.jsx`
- Modify: `portal/src/components/admin/AppearanceAdmin.jsx`

**Interfaces:**
- Produces:
  - `themeOptions.js` exports `THEME_OPTIONS` (array of `{ key, name, desc, swatch }`), `LAYOUT_OPTIONS` (array of `{ key, label, hint }`), `DENSITY_OPTIONS` (array of `{ key, label }`).
  - `ThemePreview.jsx` default-exports `ThemePreview({ s, accent })` where `s` is a `swatch` object and `accent` is an entry from `ACCENTS` in `lib/theme.js`.
  - `AppearanceControls.jsx` default-exports `AppearanceControls({ prefs, onPatch })` where `prefs` is the object returned by `getPrefs()` and `onPatch(partial)` is called with a partial prefs object. It renders the theme cards plus the Spotlight-only layout/density/accent block. It does **not** persist anything itself.

- [ ] **Step 1: Create the option tables**

Create `portal/src/components/appearance/themeOptions.js`. Move the three tables out of `AppearanceAdmin.jsx` verbatim, renaming only the exported bindings:

```js
// Swatch tables for the appearance previews, shared by the profile page and the
// admin panel.
//
// Each swatch is HARDCODED, not read from live tokens. That is deliberate: all
// four themes have to show side by side no matter which one is currently
// applied, so a preview cannot resolve `var(--color-surface)`. It also means a
// second copy of this table would drift silently, which is why there is one.

export const THEME_OPTIONS = [
  {
    key: 'classic',
    name: 'Classic',
    desc: "Today's portal look.",
    swatch: {
      bg: '#f4f5f7', surface: '#ffffff', ink: '#1a1a2e', red: '#e53e3e',
      radius: '10px', font: "'Inter', sans-serif", upper: false,
    },
  },
  {
    key: 'wp',
    name: 'WP-style',
    desc: 'Matches westcoaststrength.com.',
    swatch: {
      bg: '#f4f4f2', surface: '#ffffff', ink: '#16181d', red: '#ff0000',
      radius: '3px', font: "'WCSDisplay', 'Arial Narrow', sans-serif", upper: true,
    },
  },
  {
    key: 'spotlight',
    name: 'Spotlight',
    desc: 'Dark board with search on top.',
    // red: null means "fill from the user's live accent selection".
    swatch: {
      bg: '#0b0b0d', surface: '#131418', ink: '#f2f3f5', red: null,
      radius: '8px', font: "'Inter', sans-serif", upper: false, dark: true,
    },
  },
  {
    key: 'press',
    name: 'Press',
    desc: 'The website look, with a top nav.',
    swatch: {
      bg: '#ffffff', surface: '#ffffff', ink: '#16181d', red: '#ff0000',
      radius: '3px', font: "'WCSDisplay', 'Arial Narrow', sans-serif", upper: true,
    },
  },
]

export const LAYOUT_OPTIONS = [
  { key: 'spotlight', label: 'Spotlight', hint: 'Wide panels. Best under 12 destinations.' },
  { key: 'grid', label: 'Grid', hint: 'Square tiles. Best for tablet and front desk.' },
  { key: 'rows', label: 'Rows', hint: 'Dense list. Best for 20+ destinations.' },
]

export const DENSITY_OPTIONS = [
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'compact', label: 'Compact' },
]
```

- [ ] **Step 2: Write a test pinning the tables to the theme engine**

The tables and `lib/theme.js` must list the same keys. If someone adds a theme to `THEMES` without a swatch, the profile page renders three cards and no error.

Create `portal/src/components/appearance/themeOptions.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THEME_OPTIONS, LAYOUT_OPTIONS, DENSITY_OPTIONS } from './themeOptions.js'
import { THEMES, LAYOUTS, DENSITIES } from '../../lib/theme.js'

test('every theme in the engine has a swatch, and vice versa', () => {
  assert.deepEqual(THEME_OPTIONS.map(o => o.key).sort(), [...THEMES].sort())
})

test('every layout and density in the engine has a label', () => {
  assert.deepEqual(LAYOUT_OPTIONS.map(o => o.key).sort(), [...LAYOUTS].sort())
  assert.deepEqual(DENSITY_OPTIONS.map(o => o.key).sort(), [...DENSITIES].sort())
})

test('every swatch carries the fields the preview reads', () => {
  for (const o of THEME_OPTIONS) {
    for (const f of ['bg', 'surface', 'ink', 'radius', 'font']) {
      assert.ok(o.swatch[f], `${o.key} swatch is missing ${f}`)
    }
    assert.ok('red' in o.swatch, `${o.key} swatch is missing red (use null to mean "use the accent")`)
  }
})
```

- [ ] **Step 3: Run the test**

Run: `node --test portal/src/components/appearance/themeOptions.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 4: Move the preview component**

Create `portal/src/components/appearance/ThemePreview.jsx` containing the `Preview` function from `AppearanceAdmin.jsx` verbatim (the whole body, from `const red = s.red || accent.hex` through the closing `)`), renamed and default-exported:

```jsx
// One theme's look, rendered in its own hardcoded colors so it reads correctly
// whatever theme is currently applied. `s` is a swatch from themeOptions.js;
// `accent` is an entry from ACCENTS in lib/theme.js, used only by swatches
// whose `red` is null.
export default function ThemePreview({ s, accent }) {
  // ... body moved unchanged from AppearanceAdmin.jsx's Preview ...
}
```

Copy the body exactly. Do not retune spacing, colors or copy in this task.

- [ ] **Step 5: Move the shared controls**

Create `portal/src/components/appearance/AppearanceControls.jsx`. It holds the `Segmented` helper plus the theme-card grid and the Spotlight-only block, both moved verbatim out of `AppearanceAdmin`'s returned JSX. It is presentational: it takes `prefs` and calls `onPatch`, and never touches `setPrefs` or localStorage.

```jsx
import { ACCENTS } from '../../lib/theme'
import { THEME_OPTIONS, LAYOUT_OPTIONS, DENSITY_OPTIONS } from './themeOptions'
import ThemePreview from './ThemePreview'

function Segmented({ value, options, onChange }) {
  // ... body moved unchanged from AppearanceAdmin.jsx ...
}

/**
 * The theme / layout / density / accent pickers, with no opinion about where
 * the prefs come from or go. The profile page and the admin panel both render
 * this; only their onPatch differs.
 */
export default function AppearanceControls({ prefs, onPatch }) {
  const accent = ACCENTS.find(a => a.key === prefs.accent) || ACCENTS[0]
  const activeLayout = LAYOUT_OPTIONS.find(l => l.key === prefs.layout)

  return (
    <>
      {/* theme card grid — moved unchanged, with OPTIONS renamed to
          THEME_OPTIONS and <Preview> renamed to <ThemePreview> */}
      {/* Spotlight-only layout/density/accent block — moved unchanged, with
          LAYOUTS renamed to LAYOUT_OPTIONS and DENSITIES to DENSITY_OPTIONS */}
    </>
  )
}
```

Fill both comment placeholders with the JSX moved out of `AppearanceAdmin.jsx`, substituting `patch(...)` calls for `onPatch(...)`.

- [ ] **Step 6: Reduce AppearanceAdmin to a consumer**

`portal/src/components/admin/AppearanceAdmin.jsx` becomes:

```jsx
import { useState } from 'react'
import { getPrefs, setPrefs } from '../../lib/theme'
import AppearanceControls from '../appearance/AppearanceControls'

export default function AppearanceAdmin() {
  const [prefs, setLocalPrefs] = useState(getPrefs)
  const patch = (p) => setLocalPrefs(setPrefs(p)) // persist + apply to <html> live

  return (
    <div className="bg-surface rounded-xl border border-border p-6 max-w-3xl">
      <p className="text-sm text-text-muted mb-1">
        Choose how the portal looks for you. The change applies instantly and
        follows you to any computer you sign in on.
      </p>
      <p className="text-xs text-text-muted mb-6">
        This sets your own view. Everyone can change theirs from Profile.
      </p>
      <AppearanceControls prefs={prefs} onPatch={patch} />
    </div>
  )
}
```

Note the second paragraph changed: the old copy said "Admin-only for now", which stops being true in Task 2.

- [ ] **Step 7: Verify the build**

Run: `cd portal && npm run build`

Expected: build succeeds. Then open Admin → Portal Setup → Appearance in `npm run dev` and confirm all four cards, the accent row and the Spotlight block look and behave exactly as before. This is a refactor; anything that looks different is a mistake.

- [ ] **Step 8: Commit**

```bash
git add portal/src/components/appearance portal/src/components/admin/AppearanceAdmin.jsx
git commit -m "refactor(portal): extract the appearance controls for reuse"
```

---

### Task 2: The profile view

**Files:**
- Create: `portal/src/components/ProfileView.jsx`
- Modify: `portal/src/App.jsx`

**Interfaces:**
- Consumes: `AppearanceControls` from Task 1; `getPrefs`, `setPrefs` from `lib/theme`.
- Produces: `ProfileView({ user })`, default export. `App.jsx` gains a `showProfile` state, a `#profile` hash route and an entry in `handleBackToPortal`.

- [ ] **Step 1: Write the view**

Create `portal/src/components/ProfileView.jsx`:

```jsx
import { useState } from 'react'
import { getPrefs, setPrefs } from '../lib/theme'
import AppearanceControls from './appearance/AppearanceControls'

/**
 * Everyone's own appearance settings. Unlike the admin panel's copy of these
 * controls, this page carries no role gate at all: it changes nothing but how
 * the portal looks to the person reading it.
 *
 * Changes apply the moment they are clicked (setPrefs writes the data-*
 * attributes onto <html> synchronously) and are pushed to the server by the
 * debounced listener in lib/uiPrefs.js. There is no Save button, on purpose.
 */
export default function ProfileView({ user }) {
  const [prefs, setLocalPrefs] = useState(getPrefs)
  const patch = (p) => setLocalPrefs(setPrefs(p))

  const name = user?.staff?.display_name || user?.staff?.email || ''

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-black text-text-primary">Profile</h2>
        <p className="text-sm text-text-muted mt-1">
          {name ? `Signed in as ${name}. ` : ''}
          These settings are yours alone and follow you to any computer you sign in on.
        </p>
      </div>

      <section className="bg-surface rounded-xl border border-border p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-4">Appearance</h3>
        <AppearanceControls prefs={prefs} onPatch={patch} />
      </section>
    </div>
  )
}
```

The Background section is added to this file in Task 9. Do not stub it here.

- [ ] **Step 2: Wire the view into App.jsx**

Four edits in `portal/src/App.jsx`, following exactly how the neighbouring views are wired:

1. Import it beside the other view imports near the top:

```jsx
import ProfileView from './components/ProfileView'
```

2. Add state beside the other `show*` declarations:

```jsx
const [showProfile, setShowProfile] = useState(false)
```

3. Add it to the hash effect at ~line 271 so a deep link and the browser Back button both work:

```jsx
  useEffect(() => {
    function onHashChange() {
      setShowReporting(window.location.hash.startsWith('#reporting'))
      setShowAnalytics(window.location.hash.startsWith('#analytics'))
      setShowProfile(window.location.hash.startsWith('#profile'))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
```

4. Add `setShowProfile(false)` to `handleBackToPortal`, beside the other resets. Note the function already clears the hash at its end, so nothing else is needed there.

Then render it in the view switch, alongside the other `showX ? <XView/> :` branches. Place it **before** the home board branch and after `showAdmin`, matching how the file already orders these.

- [ ] **Step 3: Verify the route**

Run: `cd portal && npm run dev`

Then in the browser: navigate to `#profile`. Expected: the Profile page renders, theme cards work, clicking a theme re-skins the page live. Press browser Back. Expected: you land back on the board.

- [ ] **Step 4: Verify the build**

Run: `cd portal && npm run build`

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/ProfileView.jsx portal/src/App.jsx
git commit -m "feat(portal): a profile page anyone can reach at #profile"
```

---

### Task 3: The header entry point

The tile grid is the work surface, so Profile goes in the header rather than becoming a tile. That also means it needs no entry in `portalTiles.js`, no `CUSTOM_TILE_KEYS` key and no row in the roles grid: it is reachable by every authenticated user by construction.

Both shells need it. The classic header is the `<header>` block in `App.jsx` (~lines 574-616); Press replaces that entire shell with `PortalNav`.

**Files:**
- Create: `portal/src/components/UserMenu.jsx`
- Modify: `portal/src/App.jsx`
- Modify: `portal/src/components/PortalNav.jsx`
- Modify: `portal/src/index.css`

**Interfaces:**
- Consumes: Task 2's `#profile` route.
- Produces: `UserMenu({ name, onProfile, onSignOut, variant })` where `variant` is `'photo' | 'plain' | 'press'`. `PortalNav` gains an `onProfile` prop alongside its existing `onSignOut`.

- [ ] **Step 1: Write the menu**

Create `portal/src/components/UserMenu.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'

/** "Jane Doe" -> "JD"; falls back to the first character of an email. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * The signed-in person's own menu: Profile and Sign Out.
 *
 * `variant` picks the button treatment, because the control sits on three
 * different grounds: over a full-bleed photo ('photo'), on the plain surface
 * when there is no photo ('plain'), and inside the Press nav ('press'), which
 * styles its own controls from index.css rather than Tailwind utilities.
 */
export default function UserMenu({ name, onProfile, onSignOut, variant = 'plain' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const trigger =
    variant === 'press'
      ? 'press-nav__btn'
      : variant === 'photo'
        ? 'w-8 h-8 rounded-full border border-white/30 bg-white/10 text-white/90 text-xs font-bold hover:border-white/60 transition-colors'
        : 'w-8 h-8 rounded-full border border-border bg-surface text-text-muted text-xs font-bold hover:text-wcs-red hover:border-wcs-red transition-colors'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? `Account menu for ${name}` : 'Account menu'}
        title={name || 'Account'}
      >
        {variant === 'press' ? 'Account' : initials(name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-50 min-w-44 rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
        >
          {name && (
            <div className="px-3 py-2 border-b border-border text-xs text-text-muted truncate">{name}</div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onProfile() }}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg transition-colors"
          >
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onSignOut() }}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Test the one piece of logic in it**

Create `portal/src/components/userMenu.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initials } from './UserMenu.jsx'

test('initials takes first and last', () => {
  assert.equal(initials('Jane Doe'), 'JD')
  assert.equal(initials('Mary Anne Smith'), 'MS')
})

test('initials handles one name, blanks and junk', () => {
  assert.equal(initials('Cher'), 'C')
  assert.equal(initials('  spaced   out  '), 'SO')
  assert.equal(initials(''), '?')
  assert.equal(initials(null), '?')
  assert.equal(initials(undefined), '?')
})

test('initials falls back to the first character of an email', () => {
  assert.equal(initials('justin@wcstrength.com'), 'J')
})
```

- [ ] **Step 3: Run the test**

Run: `node --test portal/src/components/userMenu.test.mjs`

Expected: FAIL. Node cannot import a `.jsx` file containing JSX. This is the constraint the codebase already lives with, and it is why every existing `*.test.mjs` sits next to a plain `.js` module.

Resolve it by moving `initials` into `portal/src/lib/initials.js`:

```js
/** "Jane Doe" -> "JD"; falls back to the first character of an email. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
```

Import it in `UserMenu.jsx` (`import { initials } from '../lib/initials'`) and delete the local copy. Move the test to `portal/src/lib/initials.test.mjs`, importing from `./initials.js`.

- [ ] **Step 4: Re-run the test**

Run: `node --test portal/src/lib/initials.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 5: Replace the classic header's Sign Out button**

In `portal/src/App.jsx`, in the `<header>` block, the trailing `<button onClick={handleLogout} …>Sign Out</button>` is replaced by:

```jsx
          <UserMenu
            name={user?.staff?.display_name || user?.staff?.email}
            variant={bgImage ? 'photo' : 'plain'}
            onProfile={() => { window.location.hash = '#profile'; setShowProfile(true) }}
            onSignOut={handleLogout}
          />
```

Keep the `Admin` button and the `location` span exactly as they are. Add the import at the top: `import UserMenu from './components/UserMenu'`.

Note `variant` keys off `bgImage`, matching how every other control in this header already branches for legibility over a photo.

- [ ] **Step 6: Replace the Press nav's Sign Out button**

In `portal/src/components/PortalNav.jsx`: add `onProfile` to the destructured props beside `onSignOut`, and replace the button at ~line 165:

```jsx
        <UserMenu name={userName} variant="press" onProfile={onProfile} onSignOut={onSignOut} />
```

Add `userName` to the props list too, and `import UserMenu from './UserMenu'`.

Then in `App.jsx`, pass the two new props to `<PortalNav …>`:

```jsx
          onProfile={() => { window.location.hash = '#profile'; setShowProfile(true) }}
          userName={user?.staff?.display_name || user?.staff?.email}
```

- [ ] **Step 7: Check the menu is not clipped in the Press nav**

The Press nav is styled from `index.css` (`.press-nav`, `.press-nav__right`). An absolutely-positioned dropdown inside it will be clipped if any ancestor sets `overflow: hidden`.

Run: `grep -n "press-nav" portal/src/index.css | head -20`, then read the `.press-nav` and `.press-nav__right` rules.

If either sets `overflow: hidden`, add to `index.css`:

```css
/* The account menu drops out of the nav, so the bar cannot clip its children. */
.press-nav, .press-nav__right { overflow: visible; }
```

If neither does, add nothing.

- [ ] **Step 8: Verify both shells**

Run: `cd portal && npm run dev`

- Classic theme, on a club with a background photo: the initials button is legible over the photo, opens on click, closes on outside click and on Escape, and Profile navigates.
- Classic theme with `#profile` open: Back returns to the board.
- Switch to Press: the Account button appears in the nav, its menu is **not clipped** by the bar, and both items work.
- Sign Out still signs out in both.

- [ ] **Step 9: Verify the build**

Run: `cd portal && npm run build`

Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add portal/src/components/UserMenu.jsx portal/src/lib/initials.js portal/src/lib/initials.test.mjs portal/src/App.jsx portal/src/components/PortalNav.jsx portal/src/index.css
git commit -m "feat(portal): account menu in the header with Profile and Sign Out"
```

---

### Task 4: Org appearance default

Today `hydrateUiPrefs` treats an empty server row as "adopt whatever is in this browser", which was right when only admins had prefs. With everyone on the page, a brand-new person should instead get the org's chosen look.

The default lives in the existing `app_config` store: `GET /config/app-settings` is readable by any authenticated user and `PUT` is already `requireRole('admin')`, so **no route work is needed**. The admin UI that writes these keys is Task 12; this task only reads them.

**Files:**
- Modify: `portal/src/lib/uiPrefs.js`
- Create: `portal/src/lib/uiPrefs.test.mjs`

**Interfaces:**
- Consumes: `getAppSettings(prefix)` from `lib/api`.
- Produces: `resolveHydration({ remote, orgDefault, local })` exported from `uiPrefs.js`, returning `{ action: 'apply' | 'adopt', prefs }`. `action: 'apply'` means write these prefs locally; `action: 'adopt'` means push `prefs` up to the server as this person's first saved row.

- [ ] **Step 1: Write the failing test**

The decision is worth isolating from the I/O, because it is the only part with rules and the I/O around it cannot be unit-tested without a DOM and a server.

Create `portal/src/lib/uiPrefs.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHydration } from './uiPrefs.js'

const LOCAL = { theme: 'classic', accent: 'signal_red', density: 'comfortable', layout: 'spotlight', pinned: [] }

test('a saved server row wins over everything', () => {
  const remote = { theme: 'press', accent: 'lime', density: 'compact', layout: 'rows', pinned: ['tool:drive'] }
  const r = resolveHydration({ remote, orgDefault: { theme: 'spotlight' }, local: LOCAL })
  assert.equal(r.action, 'apply')
  assert.equal(r.prefs.theme, 'press')
  assert.deepEqual(r.prefs.pinned, ['tool:drive'])
})

test('no server row and an org default: adopt the org default', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'spotlight', accent: 'ember' }, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.equal(r.prefs.theme, 'spotlight')
  assert.equal(r.prefs.accent, 'ember')
  // Unset org keys fall through to what this browser already had.
  assert.equal(r.prefs.density, 'comfortable')
})

test('no server row and no org default: adopt what this browser had', () => {
  const r = resolveHydration({ remote: null, orgDefault: {}, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.deepEqual(r.prefs, LOCAL)
})

test('an unreadable org default is simply absent', () => {
  const r = resolveHydration({ remote: undefined, orgDefault: null, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.equal(r.prefs.theme, 'classic')
})

test('pins are never taken from the org default', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'wp', pinned: ['tool:hr'] }, local: LOCAL })
  assert.deepEqual(r.prefs.pinned, [])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test portal/src/lib/uiPrefs.test.mjs`

Expected: FAIL. `uiPrefs.js` imports `./api.js`, which will pull in browser globals — so this may fail on import rather than on the assertion. Either way it is red, and Step 3 fixes both problems by making the resolver import-free.

- [ ] **Step 3: Implement the resolver**

Add to `portal/src/lib/uiPrefs.js`, above `hydrateUiPrefs`. It touches no imports, so the test can load the module.

```js
/**
 * Decide what a person's prefs should be at login.
 *
 * Three cases, in order:
 *   1. They have a saved server row. It wins outright.
 *   2. They do not, and the org has a default. They start on the org's look,
 *      and it is written up as their first row so they can change it after.
 *   3. Neither. Adopt whatever this browser already had, which is what shipped
 *      before org defaults existed and keeps an existing user's setup.
 *
 * Pins are deliberately never seeded from the org default: a shortcut bar is
 * personal, and half of what is pinnable is role-gated anyway.
 *
 * Pure and import-free on purpose, so it is unit-testable without a DOM.
 */
export function resolveHydration({ remote, orgDefault, local }) {
  const hasRemote = remote && Object.keys(remote).length > 0
  if (hasRemote) return { action: 'apply', prefs: remote }

  const d = orgDefault || {}
  return {
    action: 'adopt',
    prefs: {
      theme: d.theme || local.theme,
      accent: d.accent || local.accent,
      density: d.density || local.density,
      layout: d.layout || local.layout,
      pinned: local.pinned,
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test portal/src/lib/uiPrefs.test.mjs`

Expected: PASS, 5 tests.

- [ ] **Step 5: Use the resolver in hydrateUiPrefs**

Replace the body of `hydrateUiPrefs` in `portal/src/lib/uiPrefs.js`:

```js
export async function hydrateUiPrefs() {
  let remote
  let orgDefault = {}
  try {
    const [res, settings] = await Promise.all([
      getUiPreferences(),
      // A missing or unreadable org default is not an error: it just means
      // there is no house style and case 3 applies.
      getAppSettings('appearance_default_').catch(() => ({})),
    ])
    remote = res?.prefs
    orgDefault = {
      theme: settings?.appearance_default_theme,
      accent: settings?.appearance_default_accent,
      density: settings?.appearance_default_density,
      layout: settings?.appearance_default_layout,
    }
  } catch {
    // Offline or API down: the localStorage mirror already painted, so there
    // is nothing to do and nothing to report.
    return
  }

  const { action, prefs } = resolveHydration({ remote, orgDefault, local: snapshot() })

  applyingFromServer = true
  try {
    // setPrefs and setPinned both normalize: an unknown theme or a retired pin
    // key falls back rather than rendering something broken.
    setPrefs({ theme: prefs.theme, accent: prefs.accent, density: prefs.density, layout: prefs.layout })
    setPinned(Array.isArray(prefs.pinned) ? prefs.pinned : [])
  } finally {
    applyingFromServer = false
  }

  // Case 2 and 3: this person has no row yet, so write what they just got.
  if (action === 'adopt') {
    try { await saveUiPreferences(snapshot()) } catch {}
  }
}
```

Add `getAppSettings` to the import from `./api`.

Note the behavior change beyond the org default: the previous version returned early in the "adopt" case **without applying anything**, which was correct only because adopting meant "keep what is already applied". Now adopting can mean applying the org's theme, so the apply happens on both paths and the save follows it.

- [ ] **Step 6: Verify**

Run: `node --test portal/src/lib/uiPrefs.test.mjs && cd portal && npm run build`

Expected: tests pass, build succeeds.

Then manually, with `npm run dev`: sign in as an existing user with saved prefs and confirm the theme is unchanged. There is no UI to set an org default until Task 12, so case 2 is covered by the unit tests only at this point.

- [ ] **Step 7: Commit**

```bash
git add portal/src/lib/uiPrefs.js portal/src/lib/uiPrefs.test.mjs
git commit -m "feat(portal): new staff start on the org appearance default"
```

---

### Task 5: Open PR A

- [ ] **Step 1: Run everything**

```bash
node --test portal/src/components/appearance/themeOptions.test.mjs
node --test portal/src/lib/initials.test.mjs
node --test portal/src/lib/uiPrefs.test.mjs
cd portal && npm run build
```

Expected: all pass, build succeeds.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/portal-profile-view
gh pr create --title "Profile page: appearance for everyone, not just admins" --body "$(cat <<'EOF'
Lifts the appearance picker out of the admin panel into a Profile page every authenticated user can reach at `#profile`, from a new account menu in the header.

- `AppearanceAdmin`'s swatch tables, preview and controls move to `components/appearance/` and are now shared by both pages rather than duplicated. Each preview renders in its own hardcoded colors so all four themes show side by side, which is exactly why a second copy would have drifted silently.
- `themeOptions.test.mjs` pins the tables to `THEMES`/`LAYOUTS`/`DENSITIES` in `lib/theme.js`, so adding a theme without a swatch now fails a test instead of rendering three cards.
- The account menu replaces the Sign Out button in both shells: the classic header and the Press nav. Profile is deliberately not a tile, so it needs no `portalTiles.js` entry, no `CUSTOM_TILE_KEYS` key and no roles-grid row.
- `hydrateUiPrefs` gains an org default: a person with no saved row now starts on the house style (`appearance_default_*` in `app_config`) instead of on whatever that browser happened to have. Existing users with saved prefs are untouched. The decision is extracted as `resolveHydration` and unit-tested.

No migration. Prefs continue to live in the existing `user_ui_preferences.prefs` blob.

The admin UI for setting the org default is a follow-up PR; this one only reads the keys.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016YuAnkYK88gn8NemE11p4H
EOF
)"
```

Do not merge. Justin merges.

---

# PR B: Background photo

Branch: `git switch -c feat/portal-profile-background origin/master` (or off PR A's branch if it has merged).

---

### Task 6: The background preference and its normalizer

**Files:**
- Modify: `portal/src/lib/theme.js`
- Create: `portal/src/lib/theme.test.mjs`

**Interfaces:**
- Produces, from `lib/theme.js`:
  - `BACKGROUND_KINDS = ['location', 'gallery', 'upload', 'none']`
  - `DEFAULT_BACKGROUND = { kind: 'location', value: '' }`
  - `DEFAULT_BACKGROUND_DIM = 60`
  - `normalizeBackground(raw)` → a valid `{ kind, value }`
  - `normalizeDim(raw)` → an integer 0-80
  - `getBackgroundPrefs()` → `{ background, backgroundDim }` read from localStorage
  - `setBackgroundPrefs({ background?, backgroundDim? })` → persists, fires `THEME_EVENT`, returns the resolved pair

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/theme.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackground, normalizeDim, DEFAULT_BACKGROUND, DEFAULT_BACKGROUND_DIM } from './theme.js'

test('a well-formed background passes through', () => {
  assert.deepEqual(normalizeBackground({ kind: 'gallery', value: 'shared/abc.jpg' }),
    { kind: 'gallery', value: 'shared/abc.jpg' })
  assert.deepEqual(normalizeBackground({ kind: 'none', value: '' }), { kind: 'none', value: '' })
})

test('an unknown kind falls back to the default', () => {
  assert.deepEqual(normalizeBackground({ kind: 'wallpaper', value: 'x' }), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground({ kind: 42, value: 'x' }), DEFAULT_BACKGROUND)
})

test('junk falls back to the default', () => {
  assert.deepEqual(normalizeBackground(null), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground(undefined), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground('gallery'), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground([]), DEFAULT_BACKGROUND)
})

test('a kind that needs a value but has none falls back', () => {
  assert.deepEqual(normalizeBackground({ kind: 'gallery' }), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground({ kind: 'upload', value: '' }), DEFAULT_BACKGROUND)
  // location and none carry no value, so a missing one is fine.
  assert.deepEqual(normalizeBackground({ kind: 'location' }), { kind: 'location', value: '' })
  assert.deepEqual(normalizeBackground({ kind: 'none' }), { kind: 'none', value: '' })
})

test('an overlong value is refused rather than truncated', () => {
  // The whole prefs blob is capped at 4096 bytes server-side; a storage path
  // is well under 200 characters, so anything longer is not one.
  assert.deepEqual(normalizeBackground({ kind: 'upload', value: 'x'.repeat(300) }), DEFAULT_BACKGROUND)
})

test('dim clamps into 0-80 and rounds', () => {
  assert.equal(normalizeDim(0), 0)
  assert.equal(normalizeDim(80), 80)
  assert.equal(normalizeDim(45.6), 46)
  assert.equal(normalizeDim(-5), 0)
  assert.equal(normalizeDim(200), 80)
})

test('a non-numeric dim falls back to the default', () => {
  assert.equal(normalizeDim('abc'), DEFAULT_BACKGROUND_DIM)
  assert.equal(normalizeDim(null), DEFAULT_BACKGROUND_DIM)
  assert.equal(normalizeDim(undefined), DEFAULT_BACKGROUND_DIM)
  assert.equal(normalizeDim(NaN), DEFAULT_BACKGROUND_DIM)
  // A numeric string is a number someone stringified. Accept it.
  assert.equal(normalizeDim('30'), 30)
})

test('the default dim reproduces the old hardcoded scrim', () => {
  assert.equal(DEFAULT_BACKGROUND_DIM, 60)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test portal/src/lib/theme.test.mjs`

Expected: FAIL with `SyntaxError: The requested module './theme.js' does not provide an export named 'normalizeBackground'`.

- [ ] **Step 3: Implement**

Add to `portal/src/lib/theme.js`, after the existing `DEFAULTS` block:

```js
export const BACKGROUND_KEY = 'wcs-portal-background'
export const BACKGROUND_DIM_KEY = 'wcs-portal-background-dim'

// 'location' keeps the club photo the portal has always shown; 'none' is a
// flat ground; 'gallery' and 'upload' both carry a storage path in `value`.
export const BACKGROUND_KINDS = ['location', 'gallery', 'upload', 'none']
export const DEFAULT_BACKGROUND = { kind: 'location', value: '' }
// 60 is not arbitrary: it is the black/60 scrim App.jsx used to hardcode, so
// everyone who never touches this sees exactly what they saw before.
export const DEFAULT_BACKGROUND_DIM = 60

const MAX_BACKGROUND_VALUE = 200

/** Coerce anything into a usable { kind, value }. Never throws. */
export function normalizeBackground(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BACKGROUND }
  if (!BACKGROUND_KINDS.includes(raw.kind)) return { ...DEFAULT_BACKGROUND }
  const value = typeof raw.value === 'string' ? raw.value : ''
  if (value.length > MAX_BACKGROUND_VALUE) return { ...DEFAULT_BACKGROUND }
  // gallery and upload are meaningless without a path; location and none are
  // meaningless with one.
  if ((raw.kind === 'gallery' || raw.kind === 'upload') && !value) return { ...DEFAULT_BACKGROUND }
  if (raw.kind === 'location' || raw.kind === 'none') return { kind: raw.kind, value: '' }
  return { kind: raw.kind, value }
}

/** Coerce anything into an integer percentage in 0-80. Never throws. */
export function normalizeDim(raw) {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN)
  if (!Number.isFinite(n)) return DEFAULT_BACKGROUND_DIM
  return Math.min(80, Math.max(0, Math.round(n)))
}

/** Read the saved background pair. Never throws. */
export function getBackgroundPrefs() {
  let background = DEFAULT_BACKGROUND
  let backgroundDim = DEFAULT_BACKGROUND_DIM
  try {
    background = normalizeBackground(JSON.parse(localStorage.getItem(BACKGROUND_KEY) || 'null'))
  } catch {}
  try {
    backgroundDim = normalizeDim(localStorage.getItem(BACKGROUND_DIM_KEY))
  } catch {}
  return { background, backgroundDim }
}

/**
 * Persist + apply a partial background patch. Fires THEME_EVENT so the sync
 * layer in uiPrefs.js pushes it up, exactly as it does for the theme.
 */
export function setBackgroundPrefs(patch) {
  const cur = getBackgroundPrefs()
  const next = {
    background: normalizeBackground(patch?.background !== undefined ? patch.background : cur.background),
    backgroundDim: normalizeDim(patch?.backgroundDim !== undefined ? patch.backgroundDim : cur.backgroundDim),
  }
  try {
    localStorage.setItem(BACKGROUND_KEY, JSON.stringify(next.background))
    localStorage.setItem(BACKGROUND_DIM_KEY, String(next.backgroundDim))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }))
  } catch {}
  return next
}
```

Also update the module's header comment, which currently claims persistence is localStorage-only with no backend. That was already stale before this change (see `lib/uiPrefs.js`); correct it while you are here:

```js
// Persistence: localStorage is the pre-paint MIRROR, not the source of truth.
// The server row (user_ui_preferences.prefs) is authoritative and is synced by
// lib/uiPrefs.js. index.html has a tiny inline copy of the read+apply step so
// nobody flashes Classic before this module loads — keep the storage keys in
// sync with that script.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test portal/src/lib/theme.test.mjs`

Expected: PASS, 8 tests.

- [ ] **Step 5: Carry the background through the sync layer**

In `portal/src/lib/uiPrefs.js`, `snapshot()` must include the two new keys or they will never reach the server:

```js
function snapshot() {
  const p = getPrefs()
  const b = getBackgroundPrefs()
  return {
    theme: p.theme, accent: p.accent, density: p.density, layout: p.layout,
    background: b.background, backgroundDim: b.backgroundDim,
    pinned: getPinned(),
  }
}
```

And `hydrateUiPrefs` must apply them, inside the existing `applyingFromServer` guard, beside the `setPrefs` call:

```js
    setBackgroundPrefs({ background: prefs.background, backgroundDim: prefs.backgroundDim })
```

Add `getBackgroundPrefs, setBackgroundPrefs` to the import from `./theme`.

Then extend `resolveHydration` to carry them, and **not** to seed them from the org default (a background is as personal as a pin):

```js
    prefs: {
      theme: d.theme || local.theme,
      accent: d.accent || local.accent,
      density: d.density || local.density,
      layout: d.layout || local.layout,
      background: local.background,
      backgroundDim: local.backgroundDim,
      pinned: local.pinned,
    },
```

- [ ] **Step 6: Extend the resolver test**

Append to `portal/src/lib/uiPrefs.test.mjs`:

```js
test('background is carried from the server row', () => {
  const remote = { theme: 'classic', background: { kind: 'upload', value: 'abc/1.jpg' }, backgroundDim: 20 }
  const r = resolveHydration({ remote, orgDefault: {}, local: LOCAL })
  assert.equal(r.prefs.background.kind, 'upload')
  assert.equal(r.prefs.backgroundDim, 20)
})

test('background is never seeded from the org default', () => {
  const local = { ...LOCAL, background: { kind: 'location', value: '' }, backgroundDim: 60 }
  const orgDefault = { theme: 'wp', background: { kind: 'gallery', value: 'shared/x.jpg' }, backgroundDim: 10 }
  const r = resolveHydration({ remote: {}, orgDefault, local })
  assert.deepEqual(r.prefs.background, { kind: 'location', value: '' })
  assert.equal(r.prefs.backgroundDim, 60)
})
```

Also add `background: { kind: 'location', value: '' }, backgroundDim: 60` to the shared `LOCAL` fixture at the top of the file.

- [ ] **Step 7: Run the tests**

Run: `node --test portal/src/lib/theme.test.mjs portal/src/lib/uiPrefs.test.mjs`

Expected: PASS, 15 tests total.

- [ ] **Step 8: Commit**

```bash
git add portal/src/lib/theme.js portal/src/lib/theme.test.mjs portal/src/lib/uiPrefs.js portal/src/lib/uiPrefs.test.mjs
git commit -m "feat(portal): background preference, normalized and synced"
```

---

### Task 7: The backgrounds route

Mirrors `auth/src/routes/ticketing.js` — multer memory storage, a private bucket created on first use, and 1-hour signed URLs.

**Files:**
- Create: `auth/src/routes/backgroundsHelpers.js`
- Create: `auth/src/routes/backgrounds.js`
- Create: `auth/src/routes/backgrounds.test.js`
- Modify: `auth/src/index.js`

**Interfaces:**
- Produces:
  - `backgroundsHelpers.js` exports `ALLOWED_MIME`, `MAX_UPLOAD_BYTES`, `MAX_PER_USER`, `isAllowedMime(m)`, `extForMime(m)`, `toPrune(files, max)`.
  - Routes: `GET /backgrounds`, `POST /backgrounds`, `DELETE /backgrounds/:id`, `POST /backgrounds/shared`, `DELETE /backgrounds/shared/:id`.
  - `GET /backgrounds` returns `{ mine: [{ id, url }], shared: [{ id, url }] }` where `id` is the object name within the user's folder (or within `shared/`) and `url` is a 1-hour signed URL.

- [ ] **Step 1: Write the failing test**

Create `auth/src/routes/backgrounds.test.js`. Only the pure helpers are tested; the route needs Supabase and is verified manually.

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isAllowedMime, extForMime, toPrune, MAX_PER_USER } = require('./backgroundsHelpers')

test('only the three image types are accepted', () => {
  assert.equal(isAllowedMime('image/jpeg'), true)
  assert.equal(isAllowedMime('image/png'), true)
  assert.equal(isAllowedMime('image/webp'), true)
  assert.equal(isAllowedMime('image/gif'), false)
  assert.equal(isAllowedMime('image/svg+xml'), false)   // SVG can carry script
  assert.equal(isAllowedMime('application/pdf'), false)
  assert.equal(isAllowedMime(''), false)
  assert.equal(isAllowedMime(null), false)
  assert.equal(isAllowedMime(undefined), false)
})

test('a mime with parameters still resolves', () => {
  assert.equal(isAllowedMime('image/jpeg; charset=binary'), true)
})

test('extension follows the mime, never the filename', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg')
  assert.equal(extForMime('image/png'), 'png')
  assert.equal(extForMime('image/webp'), 'webp')
})

test('nothing is pruned below the cap', () => {
  const files = [
    { name: 'a', created_at: '2026-01-01T00:00:00Z' },
    { name: 'b', created_at: '2026-01-02T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), [])
})

test('at the cap, the oldest is pruned to make room for one more', () => {
  const files = [
    { name: 'b', created_at: '2026-01-02T00:00:00Z' },
    { name: 'a', created_at: '2026-01-01T00:00:00Z' },
    { name: 'c', created_at: '2026-01-03T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), ['a'])
})

test('over the cap, everything above it is pruned oldest-first', () => {
  const files = [
    { name: 'a', created_at: '2026-01-01T00:00:00Z' },
    { name: 'b', created_at: '2026-01-02T00:00:00Z' },
    { name: 'c', created_at: '2026-01-03T00:00:00Z' },
    { name: 'd', created_at: '2026-01-04T00:00:00Z' },
    { name: 'e', created_at: '2026-01-05T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), ['a', 'b', 'c'])
})

test('a file with no timestamp sorts oldest rather than throwing', () => {
  const files = [
    { name: 'x' },
    { name: 'y', created_at: '2026-01-02T00:00:00Z' },
    { name: 'z', created_at: '2026-01-03T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), ['x'])
})

test('the per-user cap is 3', () => {
  assert.equal(MAX_PER_USER, 3)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd auth && node --test src/routes/backgrounds.test.js`

Expected: FAIL with `Cannot find module './backgroundsHelpers'`.

- [ ] **Step 3: Implement the helpers**

Create `auth/src/routes/backgroundsHelpers.js`:

```js
// Pure helpers for the backgrounds route, split out so they can be unit-tested
// without Supabase. Same shape as trainerAvailabilityHelpers.js.

// SVG is excluded deliberately: it is an image type that can carry script, and
// these files are served to other people's browsers from a signed URL.
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
// Personal uploads per user. Without a cap nothing in this system ever deletes
// an image and the bucket grows without bound.
const MAX_PER_USER = 3

function baseMime(m) {
  return typeof m === 'string' ? m.split(';')[0].trim().toLowerCase() : ''
}

function isAllowedMime(m) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME, baseMime(m))
}

function extForMime(m) {
  return ALLOWED_MIME[baseMime(m)] || null
}

/**
 * Which object names to delete so that adding one more stays within `max`.
 * Oldest first. A file with no created_at sorts oldest, on the grounds that a
 * file we cannot date is the one we would rather lose.
 */
function toPrune(files, max) {
  const sorted = [...(files || [])].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
  )
  const excess = sorted.length - (max - 1)
  return excess > 0 ? sorted.slice(0, excess).map(f => f.name) : []
}

module.exports = { ALLOWED_MIME, MAX_UPLOAD_BYTES, MAX_PER_USER, isAllowedMime, extForMime, toPrune }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/routes/backgrounds.test.js`

Expected: PASS, 8 tests.

- [ ] **Step 5: Implement the route**

Create `auth/src/routes/backgrounds.js`:

```js
// auth/src/routes/backgrounds.js
// Home-screen background images: each user's own uploads plus an admin-managed
// shared gallery.
//
// Storage layout in the private `portal-backgrounds` bucket:
//   {staff_id}/{uuid}.{ext}   a personal upload
//   shared/{uuid}.{ext}       the admin gallery
//
// staff_id ALWAYS comes from the token, never from the body, so one person can
// neither write nor delete another's image. That is the same rule
// uiPreferences.js states for the prefs row.
//
// The bucket is private and images are served by 1-hour signed URL. They are
// staff-uploaded photos of the inside of a gym; they should not be reachable
// by URL alone.
const { Router } = require('express')
const crypto = require('crypto')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const {
  MAX_UPLOAD_BYTES, MAX_PER_USER, isAllowedMime, extForMime, toPrune,
} = require('./backgroundsHelpers')

const router = Router()
router.use(authenticate)

const BUCKET = 'portal-backgrounds'
const SHARED = 'shared'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } })

let bucketReady = false
async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: '5MB' })
  if (error && !/exist/i.test(error.message || '')) throw error
  bucketReady = true
}

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Image exceeds the 5 MB limit' : 'Upload failed' })
    }
    next()
  })
}

async function listFolder(prefix) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 100 })
  if (error) throw error
  return (data || []).filter(f => f.name && !f.name.startsWith('.'))
}

async function signed(prefix, name) {
  const { data } = await supabaseAdmin.storage.from(BUCKET)
    .createSignedUrl(`${prefix}/${name}`, 60 * 60)
  return data?.signedUrl || null
}

async function withUrls(prefix, files) {
  return Promise.all(files.map(async f => ({ id: f.name, url: await signed(prefix, f.name) })))
}

// GET /backgrounds — this user's uploads plus the shared gallery.
router.get('/', async (req, res) => {
  try {
    await ensureBucket()
    const [mine, shared] = await Promise.all([listFolder(req.staff.id), listFolder(SHARED)])
    res.json({
      mine: await withUrls(req.staff.id, mine),
      shared: await withUrls(SHARED, shared),
      maxPerUser: MAX_PER_USER,
    })
  } catch (err) {
    console.error('[backgrounds] list failed:', err.message)
    res.status(500).json({ error: 'Could not load backgrounds' })
  }
})

async function store(prefix, req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  // Trust the sniffed mime, not the filename: the extension is derived from it
  // and the filename is never used to build the path.
  if (!isAllowedMime(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only JPEG, PNG and WebP images are accepted' })
  }
  await ensureBucket()

  if (prefix !== SHARED) {
    const existing = await listFolder(prefix)
    for (const name of toPrune(existing, MAX_PER_USER)) {
      await supabaseAdmin.storage.from(BUCKET).remove([`${prefix}/${name}`])
    }
  }

  const name = `${crypto.randomUUID()}.${extForMime(req.file.mimetype)}`
  const { error } = await supabaseAdmin.storage.from(BUCKET)
    .upload(`${prefix}/${name}`, req.file.buffer, { contentType: req.file.mimetype, upsert: false })
  if (error) throw error
  res.status(201).json({ image: { id: name, url: await signed(prefix, name) } })
}

// POST /backgrounds — a personal upload.
router.post('/', uploadSingle, async (req, res) => {
  try {
    await store(req.staff.id, req, res)
  } catch (err) {
    console.error('[backgrounds] upload failed:', err.message)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// POST /backgrounds/shared — admin only, into the gallery.
router.post('/shared', requireRole('admin'), uploadSingle, async (req, res) => {
  try {
    await store(SHARED, req, res)
  } catch (err) {
    console.error('[backgrounds] shared upload failed:', err.message)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// A stored id is a uuid plus one of three extensions. Anything else is either
// a bug or an attempt at traversal, so it is refused rather than sanitized.
const ID_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i

async function destroy(prefix, req, res) {
  if (!ID_RE.test(req.params.id || '')) return res.status(400).json({ error: 'Bad image id' })
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([`${prefix}/${req.params.id}`])
  if (error) throw error
  res.json({ ok: true })
}

// DELETE /backgrounds/shared/:id — admin only. Declared BEFORE /:id so that
// "shared" is never matched as an image id.
router.delete('/shared/:id', requireRole('admin'), async (req, res) => {
  try {
    await destroy(SHARED, req, res)
  } catch (err) {
    console.error('[backgrounds] shared delete failed:', err.message)
    res.status(500).json({ error: 'Delete failed' })
  }
})

// DELETE /backgrounds/:id — own folder only; the prefix comes from the token.
router.delete('/:id', async (req, res) => {
  try {
    await destroy(req.staff.id, req, res)
  } catch (err) {
    console.error('[backgrounds] delete failed:', err.message)
    res.status(500).json({ error: 'Delete failed' })
  }
})

module.exports = router
```

- [ ] **Step 6: Mount the route**

In `auth/src/index.js`, beside the other `app.use` lines (the `/ui-preferences` mount is at line 200):

```js
app.use('/backgrounds', require('./routes/backgrounds'))
```

Check the CORS middleware ordering rule while you are in this file: a no-path CORS middleware mounted after a route will eat its `OPTIONS` preflight. Mount `/backgrounds` in the same block as `/ui-preferences`, not at the end of the file.

- [ ] **Step 7: Verify the route file parses and the suite is green**

Run: `cd auth && node --check src/routes/backgrounds.js && node --check src/index.js && npm test`

Expected: no output from the checks, and the test suite at its pre-change baseline plus the 8 new tests.

- [ ] **Step 8: Commit**

```bash
git add auth/src/routes/backgrounds.js auth/src/routes/backgroundsHelpers.js auth/src/routes/backgrounds.test.js auth/src/index.js
git commit -m "feat(auth): backgrounds route with per-user uploads and a shared gallery"
```

---

### Task 8: Serve the background URL with the prefs

The client stores a storage *path* in its prefs; it needs a signed *URL* to render. Rather than a second round trip on every load, `GET /ui-preferences` returns it alongside the prefs.

**Files:**
- Modify: `auth/src/routes/uiPreferences.js`
- Modify: `portal/src/lib/api.js`

**Interfaces:**
- Produces: `GET /ui-preferences` → `{ prefs, backgroundUrl }`, where `backgroundUrl` is a 1-hour signed URL when `prefs.background.kind` is `gallery` or `upload`, and `null` otherwise. New client functions `listBackgrounds()`, `uploadBackground(file)`, `deleteBackground(id)`, `uploadSharedBackground(file)`, `deleteSharedBackground(id)`.

- [ ] **Step 1: Sign the background in the prefs read**

In `auth/src/routes/uiPreferences.js`, replace the `GET /` handler:

```js
// GET /ui-preferences — this user's saved prefs ({} if never saved).
//
// backgroundUrl rides along so the client does not need a second round trip
// before it can paint. The prefs blob stores a storage PATH; the bucket is
// private, so a signed URL is minted here on every read. A signed URL is
// deliberately not persisted anywhere: it expires, and a stale one in the
// client's localStorage mirror would 403 on the next load.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_ui_preferences').select('prefs')
      .eq('staff_id', req.staff.id).maybeSingle()
    if (error) throw error
    const prefs = data?.prefs || {}
    res.json({ prefs, backgroundUrl: await signBackground(req.staff.id, prefs.background) })
  } catch (err) {
    console.error('[ui-preferences] read failed:', err.message)
    res.status(500).json({ error: 'preferences read failed' })
  }
})
```

And add above it:

```js
const BACKGROUND_BUCKET = 'portal-backgrounds'

/**
 * A 1-hour signed URL for the user's chosen background, or null.
 *
 * An upload resolves under the user's own folder and a gallery pick under
 * shared/, so a user cannot name another person's folder here even if they
 * hand-edit their prefs blob: the prefix is derived from the token, and `kind`
 * only chooses between "mine" and "shared".
 *
 * A failure is not an error. A deleted image should paint no background, not
 * break the login.
 */
async function signBackground(staffId, background) {
  const kind = background?.kind
  const value = background?.value
  if ((kind !== 'upload' && kind !== 'gallery') || typeof value !== 'string' || !value) return null
  const prefix = kind === 'gallery' ? 'shared' : staffId
  try {
    const { data } = await supabaseAdmin.storage.from(BACKGROUND_BUCKET)
      .createSignedUrl(`${prefix}/${value}`, 60 * 60)
    return data?.signedUrl || null
  } catch {
    return null
  }
}
```

Note this keeps the module's stated rule intact: it still does not *validate* the prefs payload. It only resolves a path it is given, and confines that path to a prefix it derives itself.

- [ ] **Step 2: Add the client functions**

In `portal/src/lib/api.js`, beside `getUiPreferences`:

```js
// Home-screen backgrounds. The bucket is private, so every url here is a
// short-lived signed URL: fetch, use, discard. Never persist one.
export async function listBackgrounds() {
  return api('/backgrounds')
}

export async function uploadBackground(file) {
  const fd = new FormData(); fd.append('file', file)
  return api('/backgrounds', { method: 'POST', body: fd })
}

export async function deleteBackground(id) {
  return api('/backgrounds/' + encodeURIComponent(id), { method: 'DELETE' })
}

export async function uploadSharedBackground(file) {
  const fd = new FormData(); fd.append('file', file)
  return api('/backgrounds/shared', { method: 'POST', body: fd })
}

export async function deleteSharedBackground(id) {
  return api('/backgrounds/shared/' + encodeURIComponent(id), { method: 'DELETE' })
}
```

`api()` already detects a `FormData` body and skips the JSON content-type header (line 175), so no extra handling is needed.

- [ ] **Step 3: Verify**

Run: `cd auth && node --check src/routes/uiPreferences.js && npm test && cd ../portal && npm run build`

Expected: parse clean, auth suite at baseline, portal builds.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/uiPreferences.js portal/src/lib/api.js
git commit -m "feat: return a signed background URL with the prefs read"
```

---

### Task 9: Downscale before upload

A phone photo is 4-12 MB and the cap is 5 MB, so without this most uploads from a phone fail. Downscaling to 2560px also keeps the bucket small and the paint fast.

`portal/src/lib/downscaleImage.js` exists on the unmerged `origin/attach-downscale` branch. **Check first**: if that branch has merged into `origin/master` by the time you run this task, import the existing module and skip to Step 4 rather than adding a second one.

**Files:**
- Create: `portal/src/lib/downscaleImage.js`

**Interfaces:**
- Produces: `downscaleImage(file, { maxEdge = 2560, quality = 0.82 })` → `Promise<File>`. Returns the original `file` untouched if it is already small enough or if anything goes wrong.

- [ ] **Step 1: Check whether the module already exists**

Run: `git log origin/master --oneline -- portal/src/lib/downscaleImage.js`

If that prints a commit, the module has landed. Read it, use it, and skip to Step 4.

- [ ] **Step 2: Write the module**

Create `portal/src/lib/downscaleImage.js`:

```js
// Shrink an image in the browser before uploading it.
//
// A modern phone photo is 4-12 MB, over the 5 MB server cap, and nothing on a
// 2560px-wide background needs 12 megapixels. This is a convenience, not a
// guarantee: the server cap still stands, because a client can always skip it.
//
// Every failure path returns the ORIGINAL file rather than throwing. A browser
// that cannot decode the image will simply upload it and let the server decide.

const DEFAULTS = { maxEdge: 2560, quality: 0.82 }

export async function downscaleImage(file, opts = {}) {
  const { maxEdge, quality } = { ...DEFAULTS, ...opts }
  if (!file || !/^image\//.test(file.type) || file.type === 'image/gif') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  try {
    const { width, height } = bitmap
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    // Already small enough and already a JPEG: nothing to gain.
    if (scale === 1 && file.type === 'image/jpeg') return file

    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) return file
    // If re-encoding made it bigger, keep the original.
    if (blob.size >= file.size && scale === 1) return file

    const name = (file.name || 'background').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
```

- [ ] **Step 3: Note why there is no unit test**

This module needs `createImageBitmap`, `HTMLCanvasElement` and `File`, none of which exist under `node --test`, and the codebase has no DOM test environment. It is verified in Step 4 of Task 10 by uploading a real photo. Do not add a test that mocks all three; it would assert the mocks.

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/downscaleImage.js
git commit -m "feat(portal): downscale images in the browser before upload"
```

---

### Task 10: The Background section and the App.jsx wiring

**Files:**
- Create: `portal/src/components/appearance/BackgroundPicker.jsx`
- Modify: `portal/src/components/ProfileView.jsx`
- Modify: `portal/src/App.jsx`

**Interfaces:**
- Consumes: `listBackgrounds`, `uploadBackground`, `deleteBackground` from `lib/api`; `downscaleImage`; `getBackgroundPrefs`, `setBackgroundPrefs`, `normalizeDim` from `lib/theme`.
- Produces: `BackgroundPicker({ background, backgroundDim, onPatch, locationLabel })`.

- [ ] **Step 1: Write the picker**

Create `portal/src/components/appearance/BackgroundPicker.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { listBackgrounds, uploadBackground, deleteBackground } from '../../lib/api'
import { downscaleImage } from '../../lib/downscaleImage'

/**
 * Pick the home-screen background: the club photo (the default, and what the
 * portal has always shown), a shared gallery image, one of your own uploads,
 * or nothing.
 *
 * The dim slider replaces the black/60 scrim App.jsx used to hardcode. It is a
 * control rather than a constant because the right amount depends entirely on
 * the photo: a dark gym shot needs none, a bright one needs most of it.
 */
export default function BackgroundPicker({ background, backgroundDim, onPatch, locationLabel }) {
  const [mine, setMine] = useState([])
  const [shared, setShared] = useState([])
  const [maxPerUser, setMaxPerUser] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const r = await listBackgrounds()
      setMine(r.mine || [])
      setShared(r.shared || [])
      if (r.maxPerUser) setMaxPerUser(r.maxPerUser)
    } catch {
      setError('Could not load your images.')
    }
  }

  useEffect(() => { refresh() }, [])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''            // so picking the same file twice still fires
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const shrunk = await downscaleImage(file)
      const r = await uploadBackground(shrunk)
      await refresh()
      onPatch({ background: { kind: 'upload', value: r.image.id } })
    } catch (err) {
      setError(err?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(id) {
    setBusy(true)
    try {
      await deleteBackground(id)
      // If the image being deleted is the one in use, fall back to the club
      // photo rather than leaving a pref pointing at nothing.
      if (background.kind === 'upload' && background.value === id) {
        onPatch({ background: { kind: 'location', value: '' } })
      }
      await refresh()
    } catch {
      setError('Could not remove that image.')
    } finally {
      setBusy(false)
    }
  }

  const isSelected = (kind, value) => background.kind === kind && background.value === value

  function Swatch({ selected, onClick, style, label, children }) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        title={label}
        className={`relative h-20 w-32 shrink-0 rounded-lg border-2 bg-cover bg-center overflow-hidden transition-colors ${
          selected ? 'border-wcs-red' : 'border-border hover:border-wcs-red/40'
        }`}
        style={style}
      >
        {children}
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Background</p>
        <div className="flex flex-wrap gap-3">
          <Swatch
            selected={background.kind === 'location'}
            onClick={() => onPatch({ background: { kind: 'location', value: '' } })}
            label={`Your club photo${locationLabel ? ` (${locationLabel})` : ''}`}
          >
            <span className="absolute inset-0 flex items-center justify-center bg-bg text-[11px] font-semibold text-text-muted px-2 text-center">
              Club photo
            </span>
          </Swatch>

          <Swatch
            selected={background.kind === 'none'}
            onClick={() => onPatch({ background: { kind: 'none', value: '' } })}
            label="No background"
          >
            <span className="absolute inset-0 flex items-center justify-center bg-bg text-[11px] font-semibold text-text-muted">
              None
            </span>
          </Swatch>

          {shared.map(img => (
            <Swatch
              key={img.id}
              selected={isSelected('gallery', img.id)}
              onClick={() => onPatch({ background: { kind: 'gallery', value: img.id } })}
              style={{ backgroundImage: `url(${img.url})` }}
              label="Gallery image"
            />
          ))}

          {mine.map(img => (
            <div key={img.id} className="relative">
              <Swatch
                selected={isSelected('upload', img.id)}
                onClick={() => onPatch({ background: { kind: 'upload', value: img.id } })}
                style={{ backgroundImage: `url(${img.url})` }}
                label="Your image"
              />
              <button
                type="button"
                onClick={() => onRemove(img.id)}
                disabled={busy}
                aria-label="Remove this image"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-wcs-red text-white text-xs font-bold leading-none shadow"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <label className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red transition-colors cursor-pointer">
            {busy ? 'Working...' : 'Upload an image'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} disabled={busy} className="hidden" />
          </label>
          <span className="text-xs text-text-muted">
            JPEG, PNG or WebP. You can keep {maxPerUser}; the oldest is replaced after that.
          </span>
        </div>

        {error && <p className="text-xs text-wcs-red mt-2">{error}</p>}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
          Darken ({backgroundDim}%)
        </p>
        <input
          type="range"
          min="0"
          max="80"
          step="5"
          value={backgroundDim}
          onChange={(e) => onPatch({ backgroundDim: Number(e.target.value) })}
          className="w-64"
          aria-label="Background darkening"
        />
        <p className="text-xs text-text-muted mt-1">
          Turn this up if a bright photo makes the text hard to read.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the section to the profile page**

In `portal/src/components/ProfileView.jsx`: import `getBackgroundPrefs`, `setBackgroundPrefs` from `../lib/theme` and `BackgroundPicker`, hold the background pair in state, and render the section **only when the active theme actually paints a background**.

That condition matters and is not hypothetical. `App.jsx:349` reads `const shellBg = press ? null : bgImage` — Press already drops the photo, because it is a white-ground theme the full-bleed photo cannot coexist with. Offering the control there would be offering a setting that does nothing.

```jsx
  const [bg, setBg] = useState(getBackgroundPrefs)
  const patchBg = (p) => setBg(setBackgroundPrefs(p))

  // Press paints a white ground and drops the photo (see App.jsx shellBg), so
  // the control would do nothing there. The pref is still stored, so switching
  // back to another theme restores whatever was chosen.
  const themePaintsBackground = prefs.theme !== 'press'
```

```jsx
      {themePaintsBackground ? (
        <section className="bg-surface rounded-xl border border-border p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-4">Background</h3>
          <BackgroundPicker
            background={bg.background}
            backgroundDim={bg.backgroundDim}
            onPatch={patchBg}
            locationLabel={user?.staff?.locations?.find(l => l.is_primary)?.name}
          />
        </section>
      ) : (
        <section className="bg-surface rounded-xl border border-border p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-2">Background</h3>
          <p className="text-sm text-text-muted">
            The Press theme uses a plain white background. Switch to another theme to choose a photo.
          </p>
        </section>
      )}
```

- [ ] **Step 3: Wire the background into App.jsx**

Three edits in `portal/src/App.jsx`.

First, hold the signed URL and the prefs pair. `hydrateUiPrefs` already runs in an effect keyed on `user?.staff?.id`; the URL comes from the same `GET /ui-preferences` it makes, so have `hydrateUiPrefs` return it and store it:

```jsx
  const [backgroundUrl, setBackgroundUrl] = useState(null)
  const [bgPrefs, setBgPrefs] = useState(getBackgroundPrefs)
```

In the hydrate effect:

```jsx
  useEffect(() => {
    if (!user?.staff?.id) return
    startUiPrefsSync()
    hydrateUiPrefs().then(url => setBackgroundUrl(url || null))
  }, [user?.staff?.id])
```

and in `lib/uiPrefs.js`, have `hydrateUiPrefs` return `res?.backgroundUrl || null` on every path (including the two early returns, which return `null`).

Second, keep `bgPrefs` live. The profile page changes prefs through `setBackgroundPrefs`, which fires `THEME_EVENT`; `App.jsx` already listens for that event elsewhere in the file for the theme, so add the background to that listener (or add one beside it):

```jsx
  useEffect(() => {
    function onChange() { setBgPrefs(getBackgroundPrefs()) }
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])
```

Third, resolve the image and the scrim. Replace `const bgImage = LOCATION_BACKGROUNDS[location.toLowerCase()]` at line 345 with:

```jsx
  // What the background actually resolves to, in priority order:
  //   none                     -> nothing
  //   gallery / upload         -> the signed URL from the prefs read; if that
  //                               came back null (image deleted, or the URL
  //                               expired) fall back to the club photo rather
  //                               than painting a blank shell
  //   location (the default)   -> the club photo, as it has always been
  const clubPhoto = LOCATION_BACKGROUNDS[location.toLowerCase()]
  const bgImage =
    bgPrefs.background.kind === 'none' ? null
    : (bgPrefs.background.kind === 'gallery' || bgPrefs.background.kind === 'upload')
      ? (backgroundUrl || clubPhoto)
      : clubPhoto
```

`shellBg` on the next line is unchanged; it still nulls under Press.

Then the scrim at line 540:

```jsx
          <div className="fixed inset-0 z-0 bg-black" style={{ opacity: bgPrefs.backgroundDim / 100 }} />
```

Add `getBackgroundPrefs` and `THEME_EVENT` to the imports from `./lib/theme` if they are not already there.

- [ ] **Step 4: Verify end to end**

Run: `cd portal && npm run dev` with the auth service running locally.

Check each of these:

1. A user who has never touched the setting sees their club photo at the same darkness as before. **This is the regression that matters most** — compare against `origin/master` side by side.
2. Pick "None": the photo disappears, the header text stays legible.
3. Drag Darken to 0 and to 80: the scrim responds live.
4. Upload a large phone photo (4 MB+): it uploads (proving the downscale works, since the cap is 5 MB), appears as a swatch, and is selected automatically.
5. Reload: the chosen background is still there.
6. Sign in in a different browser: the background follows.
7. Upload a fourth image: the oldest disappears, and the count stays at 3.
8. Delete the image currently in use: the background falls back to the club photo rather than going blank.
9. Try to upload a PDF renamed to `.jpg`: rejected with "Only JPEG, PNG and WebP images are accepted".
10. Prove the 5 MB cap still bites, since the downscale normally hides it. Bypass the client:

```bash
head -c 6000000 /dev/urandom > /tmp/big.jpg
curl -i -X POST http://localhost:3000/backgrounds \
  -H "Authorization: Bearer $TOKEN" -F file=@/tmp/big.jpg
```

    Expected: `HTTP/1.1 413` and `{"error":"Image exceeds the 5 MB limit"}`. Adjust the port to whatever the auth service is listening on.
11. Switch to Press: the Background section explains itself instead of showing a dead control. Switch back: the previous choice is still applied.

- [ ] **Step 5: Verify the build and the tests**

Run: `node --test portal/src/lib/theme.test.mjs portal/src/lib/uiPrefs.test.mjs && cd portal && npm run build && cd ../auth && npm test`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add portal/src/components/appearance/BackgroundPicker.jsx portal/src/components/ProfileView.jsx portal/src/App.jsx portal/src/lib/uiPrefs.js
git commit -m "feat(portal): choose your home background and how far it is dimmed"
```

---

### Task 11: Open PR B

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/portal-profile-background
gh pr create --title "Profile: choose your home background" --body "$(cat <<'EOF'
Adds a Background section to the profile page: keep your club photo (the default), pick a shared gallery image, upload your own, or turn it off. A Darken slider replaces the `bg-black/60` scrim `App.jsx` used to hardcode.

Defaults are `{ kind: 'location' }` and `backgroundDim: 60`, which reproduce today's behavior exactly for anyone who never opens the section. `60` is the old hardcoded value.

- No migration and no new table: the two keys go into the existing `user_ui_preferences.prefs` blob, well inside its 4 KB cap.
- New `auth/src/routes/backgrounds.js`, following the `ticketing.js` pattern: multer memory storage, a private `portal-backgrounds` bucket, 1-hour signed URLs. The storage prefix always comes from `req.staff.id`, never the body, so one person cannot read or delete another's image. SVG is excluded from the mime allow-list because it can carry script.
- Each user keeps 3 uploads, oldest pruned. Without a cap nothing here ever deletes and the bucket grows without bound.
- `GET /ui-preferences` now returns a signed `backgroundUrl` alongside the prefs, so there is no second round trip before first paint. The signed URL is never persisted: a stale one in the localStorage mirror would 403.
- Images are downscaled to 2560px in the browser before upload, because a phone photo is usually over the 5 MB server cap. The cap still stands regardless.
- If a chosen image is deleted or its URL fails to sign, the background falls back to the club photo rather than painting a blank shell.

The Background section hides itself under the Press theme, which already drops the photo at `App.jsx` `shellBg` because it is a white-ground theme. The pref is still stored, so switching back restores the choice.

Normalizers are unit-tested (`theme.test.mjs`, 8 cases) as are the route's pure helpers (`backgrounds.test.js`, 8 cases). The JSX is not: there is no DOM test environment in this repo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016YuAnkYK88gn8NemE11p4H
EOF
)"
```

Do not merge.

---

# PR C: Admin gallery and org default

Branch: `git switch -c feat/portal-appearance-admin origin/master` (or off PR B's branch if it has merged).

---

### Task 12: The admin panels

Two panels below the existing pickers in `AppearanceAdmin`. Keep the distinction explicit in the copy: the pickers at the top change *the admin's own* look (it is the same component the profile page uses), while these two affect other people.

**Files:**
- Create: `portal/src/components/admin/SharedBackgroundsAdmin.jsx`
- Create: `portal/src/components/admin/OrgAppearanceDefault.jsx`
- Modify: `portal/src/components/admin/AppearanceAdmin.jsx`

**Interfaces:**
- Consumes: `listBackgrounds`, `uploadSharedBackground`, `deleteSharedBackground`, `getAppSettings`, `saveAppSettings` from `lib/api`; `THEME_OPTIONS`, `LAYOUT_OPTIONS`, `DENSITY_OPTIONS`; `ACCENTS` from `lib/theme`.

- [ ] **Step 1: Write the shared gallery panel**

Create `portal/src/components/admin/SharedBackgroundsAdmin.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { listBackgrounds, uploadSharedBackground, deleteSharedBackground } from '../../lib/api'
import { downscaleImage } from '../../lib/downscaleImage'

/**
 * The shared background gallery every user can pick from on their profile page.
 *
 * This is how club photos become managed content instead of files committed to
 * portal/public/. The seven existing /bg-*.jpg files stay where they are and
 * keep serving the "club photo" default; this gallery is additive.
 */
export default function SharedBackgroundsAdmin() {
  const [shared, setShared] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const r = await listBackgrounds()
      setShared(r.shared || [])
    } catch {
      setError('Could not load the gallery.')
    }
  }

  useEffect(() => { refresh() }, [])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await uploadSharedBackground(await downscaleImage(file))
      await refresh()
    } catch (err) {
      setError(err?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(id) {
    setBusy(true)
    try {
      await deleteSharedBackground(id)
      await refresh()
    } catch {
      setError('Could not remove that image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Background gallery</p>
      <p className="text-xs text-text-muted mb-3">
        Images here appear on everyone's profile page as background choices.
      </p>

      <div className="flex flex-wrap gap-3">
        {shared.map(img => (
          <div key={img.id} className="relative">
            <div
              className="h-20 w-32 rounded-lg border border-border bg-cover bg-center"
              style={{ backgroundImage: `url(${img.url})` }}
            />
            <button
              type="button"
              onClick={() => onRemove(img.id)}
              disabled={busy}
              aria-label="Remove this image from the gallery"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-wcs-red text-white text-xs font-bold leading-none shadow"
            >
              &times;
            </button>
          </div>
        ))}
        {shared.length === 0 && (
          <p className="text-xs text-text-muted">No gallery images yet.</p>
        )}
      </div>

      <div className="mt-3">
        <label className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red transition-colors cursor-pointer">
          {busy ? 'Working...' : 'Add an image'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} disabled={busy} className="hidden" />
        </label>
      </div>

      {error && <p className="text-xs text-wcs-red mt-2">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Write the org default panel**

Create `portal/src/components/admin/OrgAppearanceDefault.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { ACCENTS, DEFAULTS } from '../../lib/theme'
import { THEME_OPTIONS, LAYOUT_OPTIONS, DENSITY_OPTIONS } from '../appearance/themeOptions'

/**
 * The look a new staff member gets before they have chosen anything.
 *
 * Applied by hydrateUiPrefs when someone has no saved prefs row. Changing it
 * does NOT restyle anyone who has already set their own appearance, which is
 * almost everyone after their first login. Said plainly in the copy below,
 * because the obvious reading of "org default" is that it overrides.
 */
const FIELDS = [
  { key: 'theme', label: 'Theme', options: THEME_OPTIONS.map(o => ({ key: o.key, label: o.name })) },
  { key: 'layout', label: 'Layout', options: LAYOUT_OPTIONS },
  { key: 'density', label: 'Density', options: DENSITY_OPTIONS },
  { key: 'accent', label: 'Accent', options: ACCENTS.map(a => ({ key: a.key, label: a.label })) },
]

export default function OrgAppearanceDefault() {
  const [values, setValues] = useState(DEFAULTS)
  const [status, setStatus] = useState('')

  useEffect(() => {
    getAppSettings('appearance_default_')
      .then(s => setValues({
        theme: s.appearance_default_theme || DEFAULTS.theme,
        accent: s.appearance_default_accent || DEFAULTS.accent,
        density: s.appearance_default_density || DEFAULTS.density,
        layout: s.appearance_default_layout || DEFAULTS.layout,
      }))
      .catch(() => {})
  }, [])

  async function save(next) {
    setValues(next)
    setStatus('Saving...')
    try {
      await saveAppSettings({
        appearance_default_theme: next.theme,
        appearance_default_accent: next.accent,
        appearance_default_density: next.density,
        appearance_default_layout: next.layout,
      })
      setStatus('Saved')
      setTimeout(() => setStatus(''), 2000)
    } catch {
      setStatus('Could not save')
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
        Default for new staff
      </p>
      <p className="text-xs text-text-muted mb-3">
        The look someone gets before they choose their own. It does not change
        anyone who has already set their appearance.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        {FIELDS.map(f => (
          <label key={f.key} className="text-xs font-semibold text-text-muted">
            {f.label}
            <select
              value={values[f.key]}
              onChange={(e) => save({ ...values, [f.key]: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm font-normal text-text-primary"
            >
              {f.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        ))}
      </div>

      {status && <p className="text-xs text-text-muted mt-2">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Mount both panels**

In `portal/src/components/admin/AppearanceAdmin.jsx`, below `<AppearanceControls …/>`:

```jsx
      <div className="mt-8 pt-6 border-t border-border space-y-8">
        <SharedBackgroundsAdmin />
        <OrgAppearanceDefault />
      </div>
```

Add both imports. Also amend the intro copy so the split is unmistakable:

```jsx
      <p className="text-sm text-text-muted mb-1">
        The controls below change how the portal looks for you. Everyone can
        change their own from Profile.
      </p>
      <p className="text-xs text-text-muted mb-6">
        The gallery and the default at the bottom of this page affect other staff.
      </p>
```

- [ ] **Step 4: Verify**

Run: `cd portal && npm run build`, then `npm run dev` as an admin:

1. Admin → Portal Setup → Appearance shows the pickers, then the gallery, then the default.
2. Add a gallery image. Open Profile: it appears as a choice. Pick it, reload, it holds.
3. Remove it from the gallery. A user who had it selected falls back to the club photo (Task 10, Step 3's fallback), rather than a blank shell.
4. Set the org default to Spotlight. Confirm your own theme does **not** change.
5. Confirm a non-admin gets 403 on `POST /backgrounds/shared` (check the network tab, or `curl` with a team-member token).

- [ ] **Step 5: Run everything**

```bash
node --test portal/src/lib/theme.test.mjs portal/src/lib/uiPrefs.test.mjs portal/src/lib/initials.test.mjs
node --test portal/src/components/appearance/themeOptions.test.mjs
cd portal && npm run build
cd ../auth && npm test
```

Expected: all pass.

- [ ] **Step 6: Commit and open PR C**

```bash
git add portal/src/components/admin
git commit -m "feat(portal): shared background gallery and an org appearance default"
git push -u origin feat/portal-appearance-admin
gh pr create --title "Appearance admin: shared gallery and org default" --body "$(cat <<'EOF'
Two panels under Admin → Portal Setup → Appearance.

**Background gallery** — upload and remove the images that appear as background choices on everyone's profile page. This is how club photos become managed content instead of files committed to `portal/public/`. The seven existing `/bg-*.jpg` files stay put and keep serving the "club photo" default; the gallery is additive.

**Default for new staff** — the theme, layout, density and accent someone gets before they have chosen their own, stored as `appearance_default_*` in `app_config` and read by `hydrateUiPrefs`. It does not restyle anyone who has already set their appearance, which the panel says explicitly, because the obvious reading of "org default" is that it overrides.

No new route: `/backgrounds/shared` shipped in the background PR and `PUT /config/app-settings` was already `requireRole('admin')`.

The page's intro copy now distinguishes the two halves: the pickers at the top change the admin's own look (same component the profile page renders), while these panels affect other staff.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016YuAnkYK88gn8NemE11p4H
EOF
)"
```

Do not merge.

---

## Notes for whoever executes this

**The one regression to watch.** Every user who never opens the Background section must see exactly what they see today: their club photo under a 60% black scrim. Task 10 Step 4 check 1 is the guard. If it fails, the defaults in Task 6 are wrong, not the wiring.

**Why so little of the UI is unit-tested.** There is no DOM test environment in this repo and no test script in `portal/package.json`; every existing `*.test.mjs` tests a plain `.js` module with `node --test`. This plan follows that rather than introducing jsdom and a test runner as a side effect of a feature. What is testable has been pushed into pure modules on purpose: `normalizeBackground`, `normalizeDim`, `resolveHydration`, `initials`, `toPrune`, `isAllowedMime`. The JSX is verified by build plus the manual checklists.

**Two spec open items are now resolved.** The spec asked whether the Background control should hide under Spotlight; reading `App.jsx:349` shows the real answer is **Press**, not Spotlight, because Press is the theme that already nulls `shellBg`. Spotlight paints a background fine. The spec also deferred the exact grant shape for the WhenIWork migration; that is settled in the other plan, using `105_ticketing_replaces_clickup_tickets.sql` as the template.
