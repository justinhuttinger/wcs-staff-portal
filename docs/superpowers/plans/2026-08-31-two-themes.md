# Two Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the portal's appearance options to Classic and Press only, remove the settings that existed solely to serve the retired themes, and let a user open a large preview of a theme by clicking its card before applying it.

**Architecture:** The appearance engine writes `data-*` attributes onto `<html>` and `index.css` redefines tokens per attribute. Removing two of the four themes therefore means deleting their token blocks, shrinking the allow-lists in `lib/theme.js` and the pre-paint script in `index.html`, and deleting the three preferences (`accent`, `density`, `layout`) that only ever had an effect under Spotlight. Users holding a retired value need no migration: the existing normalizer already falls unknown values back to the default.

**Tech Stack:** React 19 + Vite 8 + Tailwind 4. Tests are `node:test` run as `node --test <path>`; there is no `test` script in `portal/package.json` and no DOM test environment, so only import-free `.js` modules are unit-tested.

**Spec:** none. The requirements were settled directly with Justin and are recorded in Global Constraints below.

## Global Constraints

- **The only themes are `classic` and `press`.** `wp` and `spotlight` are removed everywhere.
- **`accent`, `density` and `layout` are removed entirely**, along with `ACCENTS`, `LAYOUTS`, `DENSITIES`, their storage keys, their `data-*` attributes and their CSS. Verified before deciding: `lib/theme.js` states these only mean anything under Spotlight, and every `[data-layout]` rule in `index.css` is prefixed `[data-theme='spotlight']`.
- **Existing users on `wp` or `spotlight` silently become Classic.** No migration. `applyPrefs` already normalizes an unknown theme to `DEFAULTS.theme`.
- **`PortalSearch` is deleted with Spotlight**, along with the search-haystack plumbing that feeds it. Justin confirmed this explicitly, as a deliberate feature removal.
- **TRAP, do not fall into it:** `AdminPanel.jsx` contains a `{ key: 'spotlight', label: 'Spotlight', desc: 'Day Wins & Losses (Beta)' }` entry. That is a **REPORT**, an entirely different feature that merely shares the word. It must not be touched. Never grep-and-delete on the string `spotlight`.
- Clicking a theme card opens a **modal preview**; the theme is applied from a button inside the modal, not by the click on the card.
- Non-test files use extensionless imports; only `*.test.mjs` uses explicit `.js` extensions.
- No em-dashes in user-facing copy.
- No migration, no schema change. The retired keys simply stop being read.

---

### Task 1: Shrink the appearance engine

**Files:**
- Modify: `portal/src/lib/theme.js`
- Modify: `portal/src/lib/theme.test.mjs`
- Modify: `portal/index.html`

**Interfaces:**
- Produces: `THEMES` equals `['classic', 'press']`; `DEFAULTS` equals `{ theme: 'classic' }`; `getPrefs()` returns `{ theme }` only; `applyPrefs` and `setPrefs` accept and return `{ theme }` only. Delete `ACCENTS`, `LAYOUTS`, `DENSITIES`, `ACCENT_KEY`, `DENSITY_KEY`, `LAYOUT_KEY`. Keep `THEME_KEY`, `THEME_EVENT`, and the background exports untouched.

- [ ] **Step 1: Write the failing tests first**

Add to `portal/src/lib/theme.test.mjs`, extending its existing import line rather than adding a second one:

```js
test('only classic and press are offered', () => {
  assert.deepEqual([...THEMES].sort(), ['classic', 'press'])
})

test('a retired theme falls back to classic', () => {
  // Users who chose wp or spotlight before they were removed must land
  // somewhere sensible rather than rendering unstyled. This normalizer is
  // what replaces a data migration.
  assert.equal(applyPrefs({ theme: 'spotlight' }).theme, 'classic')
  assert.equal(applyPrefs({ theme: 'wp' }).theme, 'classic')
  assert.equal(applyPrefs({ theme: 'nonsense' }).theme, 'classic')
  assert.equal(applyPrefs({}).theme, 'classic')
  assert.equal(applyPrefs(null).theme, 'classic')
})

test('press survives', () => {
  assert.equal(applyPrefs({ theme: 'press' }).theme, 'press')
})
```

`applyPrefs` writes to `document.documentElement`, and there is no `document` under `node --test`. **Guard the DOM writes** so the normalization half stays testable, and say why in a comment. Something of this shape:

```js
  const el = typeof document === 'undefined' ? null : document.documentElement
  if (el) {
    if (p.theme === 'classic') el.removeAttribute('data-theme')
    else el.setAttribute('data-theme', p.theme)
  }
  return p
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test portal/src/lib/theme.test.mjs`

Expected: FAIL, because `THEMES` still has four entries and `applyPrefs` throws on a missing `document`.

- [ ] **Step 3: Shrink `lib/theme.js`**

- `THEMES = ['classic', 'press']`
- Delete `LAYOUTS`, `DENSITIES`, `ACCENTS`, `ACCENT_KEY`, `DENSITY_KEY`, `LAYOUT_KEY`
- `DEFAULTS = { theme: 'classic' }`
- `getPrefs()` returns only `{ theme: ... }`
- `applyPrefs(prefs)` normalizes the theme, writes or removes `data-theme` only, and no longer writes `data-accent`, `data-density` or `data-layout`. Guard the DOM writes as above.
- `setPrefs(patch)` persists only `THEME_KEY` and still fires `THEME_EVENT`.
- Rewrite the module header comment. It currently documents four themes and four attributes. It must describe two themes and one attribute, and record WHY the other three settings went, so a future reader does not reintroduce them.

Leave every background export exactly as it is.

- [ ] **Step 4: Shrink the pre-paint script**

`portal/index.html` around lines 21-25 allow-lists four themes and writes three extra attributes. Reduce the theme line to a two-value allow-list and delete the `data-accent`, `data-density` and `data-layout` lines:

```html
        var t = pick('wcs-portal-theme', ['classic', 'press'], 'classic')
        if (t !== 'classic') d.setAttribute('data-theme', t)
```

Update the surrounding comment, which mentions the fallback accent.

- [ ] **Step 5: Run the tests**

Run: `node --test portal/src/lib/theme.test.mjs`

Expected: PASS, including the pre-existing background tests, which must not regress.

- [ ] **Step 6: Commit**

```bash
git add portal/src/lib/theme.js portal/src/lib/theme.test.mjs portal/index.html
git commit -m "feat(portal): two themes, and drop the settings only Spotlight used"
```

---

### Task 2: Drop the retired prefs from the sync layer

**Files:**
- Modify: `portal/src/lib/uiPrefs.js`
- Modify: `portal/src/lib/uiPrefsResolve.js`
- Modify: `portal/src/lib/uiPrefsResolve.test.mjs`

**Interfaces:**
- Consumes: Task 1's `getPrefs()` shape.
- Produces: `snapshot()` returns `{ theme, background, backgroundDim, pinned }`; `resolveHydration` carries that same set and reads only `appearance_default_theme` from the org default.

- [ ] **Step 1: Update the resolver tests first**

In `portal/src/lib/uiPrefsResolve.test.mjs`, remove `accent`, `density` and `layout` from the `LOCAL` fixture and from every assertion. Keep all five existing behaviors under test: a saved server row wins; no row plus an org default adopts the default; no row and no default adopts the browser's own; pins are never seeded from the default; background is never seeded from the default.

Add one case pinning the reduction:

```js
test('a retired org-default key is ignored', () => {
  // appearance_default_accent and friends may still sit in app_config from
  // before these settings were removed. They must not reappear in prefs.
  const r = resolveHydration({
    remote: {},
    orgDefault: { theme: 'press', accent: 'lime', density: 'compact', layout: 'rows' },
    local: LOCAL,
  })
  assert.equal(r.prefs.theme, 'press')
  assert.equal(r.prefs.accent, undefined)
  assert.equal(r.prefs.density, undefined)
  assert.equal(r.prefs.layout, undefined)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test portal/src/lib/uiPrefsResolve.test.mjs`

Expected: FAIL on the new case.

- [ ] **Step 3: Update the two modules**

- `uiPrefsResolve.js`: `resolveHydration` returns `{ theme, background, backgroundDim, pinned }` and no longer reads `accent`, `density` or `layout` from `orgDefault` or `local`.
- `uiPrefs.js`: `snapshot()` drops the three keys; `hydrateUiPrefs` builds `orgDefault` from `appearance_default_theme` only, and its `setPrefs({ ... })` call passes only `theme`.

Leave the stale `appearance_default_accent`, `_density` and `_layout` rows in `app_config` alone: nothing reads them, and deleting them needs a migration this change does not warrant. Record that in a comment so it is a decision rather than an oversight.

- [ ] **Step 4: Run the tests**

Run: `node --test portal/src/lib/uiPrefsResolve.test.mjs portal/src/lib/theme.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/uiPrefs.js portal/src/lib/uiPrefsResolve.js portal/src/lib/uiPrefsResolve.test.mjs
git commit -m "feat(portal): sync only the theme, not the retired appearance prefs"
```

---

### Task 3: Delete the retired CSS and PortalSearch

**Files:**
- Modify: `portal/src/index.css`
- Delete: `portal/src/components/PortalSearch.jsx`
- Modify: `portal/src/components/ToolGrid.jsx`
- Modify: `portal/src/components/ToolButton.jsx`

**Interfaces:**
- Produces: no `[data-theme='wp']`, `[data-theme='spotlight']`, `[data-accent]` or `[data-density]` rules remain; `ToolGrid` no longer imports or renders `PortalSearch`.

- [ ] **Step 1: Remove the retired CSS**

In `portal/src/index.css`, delete every rule whose selector includes `[data-theme='wp']`, `[data-theme='spotlight']`, `[data-accent=...]` or `[data-density=...]`, together with the section comments introducing them. There are roughly 62 `wp`/`spotlight` selector lines, 6 `data-accent` and 3 `data-density`.

**Leave the `[data-theme='press']` block completely alone.** Press survives and its rules are load-bearing.

Afterwards look for rules left orphaned: a class that only ever appeared under a deleted selector. Report any you find rather than guessing at them.

- [ ] **Step 2: Remove PortalSearch**

Delete `portal/src/components/PortalSearch.jsx`.

In `portal/src/components/ToolGrid.jsx`:
- remove `import PortalSearch from './PortalSearch'`
- remove `const spotlight = theme === 'spotlight'` (around line 128) and both `{spotlight && <PortalSearch />}` renders (around lines 373 and 431)
- remove the effect guarded by `if (!spotlight) return` (around line 148) if it exists solely to serve the search; read it first and say what it did
- remove the search-haystack field and its comment (around line 55)

In `portal/src/components/ToolButton.jsx`, remove the search-haystack field and its comment (around line 59).

If removing `spotlight` leaves `theme` unused in `ToolGrid`, remove it and any now-unused import.

- [ ] **Step 3: Verify nothing references the removed pieces**

```
grep -rn "PortalSearch" portal/src
grep -rn "data-accent\|data-density\|data-layout" portal/src
```

Both expected to return nothing.

Then, carefully:

```
grep -rn "spotlight" portal/src
```

**Expect exactly one file to still match: `portal/src/components/AdminPanel.jsx`**, whose `key: 'spotlight'` is the Day Wins and Losses REPORT, a different feature. Leave it untouched. Report which lines you left and why. Any other remaining hit is yours to remove.

- [ ] **Step 4: Verify the build**

Run: `cd portal && npm run build`

Expected: success.

- [ ] **Step 5: Commit**

```bash
git rm portal/src/components/PortalSearch.jsx
git add portal/src/index.css portal/src/components/ToolGrid.jsx portal/src/components/ToolButton.jsx
git commit -m "feat(portal): remove the retired theme styles and the Spotlight board search"
```

---

### Task 4: Two theme cards, with a click-to-open preview modal

**Files:**
- Modify: `portal/src/components/appearance/themeOptions.js`
- Modify: `portal/src/components/appearance/themeOptions.test.mjs`
- Modify: `portal/src/components/appearance/ThemePreview.jsx`
- Modify: `portal/src/components/appearance/AppearanceControls.jsx`
- Create: `portal/src/components/appearance/ThemePreviewModal.jsx`

**Interfaces:**
- Produces: `THEME_OPTIONS` with exactly two entries; `LAYOUT_OPTIONS` and `DENSITY_OPTIONS` deleted; `ThemePreview({ s })` with no `accent` prop; `AppearanceControls({ prefs, onPatch })` unchanged in signature.

- [ ] **Step 1: Update the option tables and their test**

In `themeOptions.js`, keep only the `classic` and `press` entries, unchanged, and delete `LAYOUT_OPTIONS` and `DENSITY_OPTIONS`.

In `themeOptions.test.mjs`, drop the layout and density parity assertions, keep the theme parity one (now two keys against `THEMES`), and keep the swatch-completeness test. The `red: null` case existed only for Spotlight, so add an assertion that every surviving swatch has a real `red` value.

- [ ] **Step 2: Run the test**

Run: `node --test portal/src/components/appearance/themeOptions.test.mjs`

Expected: PASS.

- [ ] **Step 3: Simplify ThemePreview**

`ThemePreview` takes `{ s, accent }` and uses `accent` only where `s.red` is null, which was the Spotlight case. Remove the `accent` prop, use `s.red` directly, and collapse the `redInk` branch to the `#fff` the surviving swatches use. Update every call site.

- [ ] **Step 4: Build the preview modal**

Create `portal/src/components/appearance/ThemePreviewModal.jsx`.

Requirements:
- Opens when a theme card is clicked, showing a LARGE preview of that theme, bigger and more representative than the small card swatch. Reuse `ThemePreview` at a larger size rather than writing a second renderer.
- Shows the theme's name and description.
- An **Apply** button that calls back with the theme key and closes; a **Cancel** that dismisses without changing anything.
- Closes on Escape and on a backdrop click.
- **Portal it to `document.body`. This is not optional.** `App.jsx` has sibling stacking contexts at equal `z-index`, so a modal rendered inside the page content paints under other chrome. This exact bug was already shipped and fixed once in `UserMenu.jsx`; read that file and `LocationMultiSelect.jsx` as the in-repo templates. Choose a `z-index` consistent with the values already in use, and justify it in a comment: the impersonation banner is `z-[100]`, the account menu is `z-[120]`, the Press quick-actions menu is `z-index: 130`, the pin overlay is `z-index: 200`.
- `role="dialog"`, `aria-modal="true"`, an accessible name, and focus returned to the invoking card on close.
- No em-dashes in the copy.

- [ ] **Step 5: Rework AppearanceControls**

- Render the two theme cards. **Clicking a card opens the modal rather than applying the theme.** The theme changes only via the modal's Apply button, which calls `onPatch({ theme })`.
- Keep a clear selected-state affordance on whichever card is the active theme.
- Delete the entire Spotlight-gated block: the layout `Segmented`, the density `Segmented` and the accent swatch row. Delete the `Segmented` helper if nothing else uses it.
- Keep the `AppearanceControls({ prefs, onPatch })` signature. `ProfileView` and `AppearanceAdmin` both render it and neither should need a change.
- Cards must stay keyboard operable.

- [ ] **Step 6: Verify**

```
node --test portal/src/components/appearance/themeOptions.test.mjs portal/src/lib/theme.test.mjs portal/src/lib/uiPrefsResolve.test.mjs
cd portal && npm run build
```

Expected: all pass, build succeeds.

Read back and confirm `ProfileView.jsx` and `AppearanceAdmin.jsx` are unchanged and neither passes a removed prop.

- [ ] **Step 7: Commit**

```bash
git add portal/src/components/appearance
git commit -m "feat(portal): click a theme to preview it before applying"
```

---

### Task 5: Sweep for anything left behind

**Files:** whatever the sweep finds.

- [ ] **Step 1: Search for orphans**

Run each and read every hit before acting:

```
grep -rn "accent\|density" portal/src --include=*.js --include=*.jsx
grep -rn "LAYOUT_OPTIONS\|DENSITY_OPTIONS\|Segmented" portal/src
grep -rn "appearance_default_" portal/src auth/src
```

`appearance_default_theme` must survive. `appearance_default_accent`, `_density` and `_layout` must no longer be read anywhere in the client.

- [ ] **Step 2: Confirm the admin panel's Spotlight report is intact**

Run: `grep -n "Day Wins" portal/src/components/AdminPanel.jsx`

Expected: still present. This is the trap named in Global Constraints; confirm explicitly it was not collateral damage.

- [ ] **Step 3: Full verification**

```
node --test portal/src/lib/theme.test.mjs portal/src/lib/uiPrefsResolve.test.mjs portal/src/lib/initials.test.mjs portal/src/lib/downscaleImage.test.mjs portal/src/components/appearance/themeOptions.test.mjs
cd portal && npm run build
```

Expected: all pass, build succeeds.

- [ ] **Step 4: Commit anything the sweep changed**

```bash
git commit -am "chore(portal): sweep up the retired appearance settings"
```
