# Classic Tiles and a Custom Accent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Classic tile the same, slightly smaller size; give tiles a colored hover state with white text and icons; and let each user pick that color in their profile.

**Architecture:** The accent is one new preference stored in the existing `user_ui_preferences.prefs` blob, normalized in `lib/theme.js` like every other pref, and reflected onto `<html>` as a CSS custom property. Only Classic's tile styles read it, so the rest of the portal is untouched. Tile sizing is a change to the two tile components, which already share identical classes.

**Tech Stack:** React 19 + Vite 8 + Tailwind 4. Tests are `node:test` run as `node --test <path>`; there is no `test` script in `portal/package.json` and no DOM test environment, so only import-free `.js` modules are unit-tested.

**Spec:** none. Requirements were settled directly with Justin and are recorded below.

## Global Constraints

- **One color drives both** the tile icon color and the tile hover fill. There is not a separate icon setting.
- **Classic only.** Press keeps its fixed look and must not read the accent.
- **A curated palette plus a custom hex field.** The palette entries are known-good; the custom field is free.
- **Do NOT repurpose `--color-wcs-red`.** It is used across the whole app for buttons, spinners and badges. Introduce a separate custom property that only Classic tile styles consume, so choosing navy does not recolor the entire portal.
- **Readability is enforced, not hoped for.** With a free hex field a user can pick a pale color where white text vanishes. The ink color (what sits on top of the accent on hover) is COMPUTED from the accent's luminance, not fixed to white.
- Default accent is `#e53e3e`, the current `--color-wcs-red` value, so anyone who never touches this sees exactly today's colors.
- Non-test files use extensionless imports; only `*.test.mjs` uses explicit `.js` extensions.
- No em-dashes in user-facing copy.
- No migration, no schema change, no server changes. The pref rides in the existing JSONB blob.

---

### Task 1: Uniform, slightly smaller tiles

Justin reports some tiles (he named Insights and Indeed) render larger than the rest. Both tile components already carry **identical** classes: `portal-tile group relative flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] …`. Nothing makes those two intrinsically bigger.

The cause is `min-h-[160px]`: it is a floor, not a height. A tile whose label wraps to a second line grows past it, and CSS grid then stretches every tile in that row to match. Making the height fixed removes the whole class of problem without needing to identify which label wrapped.

**Files:**
- Modify: `portal/src/components/ToolButton.jsx`
- Modify: `portal/src/components/ToolGrid.jsx` (the `SvgTileButton` component)

**Interfaces:** no signature changes. Both components keep their current props.

- [ ] **Step 1: Make the height fixed and slightly smaller**

In BOTH components, change the root element's sizing from `p-8 min-h-[160px]` to `p-6 h-[140px]`.

The two class strings must stay identical to each other. They are already, and a future reader will assume it; if they drift, one grid renders differently from the other.

- [ ] **Step 2: Stop long labels breaking the fixed height**

With a fixed height, a two-line label no longer grows the tile: it overflows it. Constrain the text block so that cannot happen.

On the `portal-tile__label` span, clamp to two lines and keep the tile's internal layout stable. Tailwind 4 ships `line-clamp-*`, so `line-clamp-2` on the label is enough. Add `min-w-0` to the `portal-tile__text` wrapper so the clamp can actually take effect inside a flex column.

Do the same in both components.

- [ ] **Step 3: Check the longest labels still fit**

The longest labels in the board today include "Send Notifications", "Marketing Tracker", "Tickets/Support", "D1 Availability" and "Tour Check-In", plus whatever custom tiles exist (Indeed, Operandio, VistaPrint, Cancel Tool). With `h-[140px]`, `p-6`, a `w-14 h-14` icon and `gap-3`, verify by arithmetic that a two-line label plus the uppercase description still fits inside 140px without clipping. Show the arithmetic in your report.

If it does not fit, prefer reducing the icon circle to `w-12 h-12` over growing the tile back. Say what you changed and why.

- [ ] **Step 4: Verify**

Run: `cd portal && npm run build`

Expected: success. There is no DOM test environment, so the visual result is verified by reading plus the arithmetic above.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/ToolButton.jsx portal/src/components/ToolGrid.jsx
git commit -m "feat(portal): uniform, slightly smaller Classic tiles"
```

---

### Task 2: The accent preference

**Files:**
- Modify: `portal/src/lib/theme.js`
- Modify: `portal/src/lib/theme.test.mjs`
- Modify: `portal/index.html`

**Interfaces:**
- Produces, from `lib/theme.js`: `ACCENT_KEY`, `ACCENT_PRESETS` (array of `{ hex, label }`), `DEFAULT_ACCENT` (`'#e53e3e'`), `normalizeAccent(raw)`, `accentInk(hex)`, `getAccent()`, `setAccent(hex)`. `getPrefs()` gains `accent`; `applyPrefs` writes the CSS custom properties.

- [ ] **Step 1: Write the failing tests**

Add to `portal/src/lib/theme.test.mjs`:

```js
test('a valid hex passes through, normalized to lowercase 6-digit', () => {
  assert.equal(normalizeAccent('#1D4ED8'), '#1d4ed8')
  assert.equal(normalizeAccent('#abc'), '#aabbcc')   // 3-digit shorthand expands
})

test('junk falls back to the default', () => {
  for (const bad of ['red', 'rgb(1,2,3)', '#12', '#12345', '#1234567', 'e53e3e', '', null, undefined, 42, {}]) {
    assert.equal(normalizeAccent(bad), DEFAULT_ACCENT)
  }
})

test('the default is the red the portal already uses', () => {
  assert.equal(DEFAULT_ACCENT, '#e53e3e')
})

test('ink is white on dark accents and near-black on light ones', () => {
  // This is what stops a pale custom color making white text unreadable.
  assert.equal(accentInk('#e53e3e'), '#ffffff')   // the default red
  assert.equal(accentInk('#0b0b0d'), '#ffffff')   // near black
  assert.equal(accentInk('#1d4ed8'), '#ffffff')   // deep blue
  assert.equal(accentInk('#fde047'), '#0b0b0d')   // pale yellow
  assert.equal(accentInk('#ffffff'), '#0b0b0d')   // white
  assert.equal(accentInk('#a3e635'), '#0b0b0d')   // lime
})

test('ink is computed from luminance, not from a lookup of known values', () => {
  // An arbitrary color the palette has never seen must still get sane ink.
  assert.equal(accentInk('#000080'), '#ffffff')
  assert.equal(accentInk('#fffacd'), '#0b0b0d')
})

test('every preset is a valid hex and survives normalization', () => {
  for (const p of ACCENT_PRESETS) {
    assert.equal(normalizeAccent(p.hex), p.hex, `${p.label} is not already normalized`)
    assert.ok(p.label, 'every preset needs a label')
  }
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test portal/src/lib/theme.test.mjs`

Expected: FAIL, no such exports.

- [ ] **Step 3: Implement**

In `portal/src/lib/theme.js`:

```js
export const ACCENT_KEY = 'wcs-portal-accent'

// The red the portal has always used. Anyone who never opens the setting sees
// exactly what they saw before.
export const DEFAULT_ACCENT = '#e53e3e'

// Known-good starting points. The custom field accepts anything, so these are
// a convenience, not a guarantee: readability is enforced by accentInk below,
// which is what actually protects a bad custom choice.
export const ACCENT_PRESETS = [
  { hex: '#e53e3e', label: 'WCS Red' },
  { hex: '#c8102e', label: 'Deep Red' },
  { hex: '#ea580c', label: 'Ember' },
  { hex: '#1d4ed8', label: 'Blue' },
  { hex: '#0f766e', label: 'Teal' },
  { hex: '#4d7c0f', label: 'Olive' },
  { hex: '#6d28d9', label: 'Violet' },
  { hex: '#1a1a2e', label: 'Navy' },
]

/** Coerce anything into a #rrggbb string. Never throws. */
export function normalizeAccent(raw) {
  if (typeof raw !== 'string') return DEFAULT_ACCENT
  const s = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  // Expand #abc to #aabbcc so the rest of the system only ever sees one shape.
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('')
  return DEFAULT_ACCENT
}

/**
 * The text and icon color that sits ON TOP of the accent when a tile is
 * hovered. Computed from relative luminance rather than fixed to white,
 * because the custom field lets someone pick a pale color where white text
 * would disappear.
 *
 * Uses the WCAG relative-luminance formula with sRGB gamma expansion, and the
 * conventional 0.179 threshold, which is the luminance at which white and
 * black give equal contrast.
 */
export function accentInk(hex) {
  const h = normalizeAccent(hex)
  const channel = (i) => {
    const v = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  return L > 0.179 ? '#0b0b0d' : '#ffffff'
}
```

Then wire it into the existing pref plumbing:

- `getPrefs()` returns `{ theme, accent }`, reading `ACCENT_KEY` through `normalizeAccent`.
- `applyPrefs(prefs)` normalizes the accent and, inside its existing `document` guard, sets two custom properties on `<html>`:
  `--portal-accent` (the accent) and `--portal-accent-ink` (from `accentInk`).
  **Do not touch `--color-wcs-red`.**
- `setPrefs(patch)` persists `ACCENT_KEY` alongside the theme and still fires `THEME_EVENT`.
- Add `getAccent()` and `setAccent(hex)` convenience wrappers mirroring `getTheme`/`setTheme`.
- Update the module header comment, which currently describes one attribute, to describe the accent too and to say why it is deliberately separate from `--color-wcs-red`.

- [ ] **Step 4: Update the pre-paint script**

`portal/index.html` applies the theme before first paint so nobody sees a flash. The accent needs the same treatment, or every load flashes the default red before the real color lands.

Add to the inline script, keeping its existing shape and its storage keys in sync with `theme.js`:

```html
        var a = localStorage.getItem('wcs-portal-accent')
        if (a && /^#[0-9a-f]{6}$/i.test(a)) {
          d.style.setProperty('--portal-accent', a.toLowerCase())
        }
```

The ink property is deliberately NOT computed here: duplicating the luminance formula in an inline script is how the two drift apart. Instead, give `--portal-accent-ink` a sensible default in CSS (see Task 3) so the pre-paint state is readable, and let `applyPrefs` set the exact value moments later.

Say in your report why that split is safe: the ink only matters on hover, which cannot happen before the app has hydrated.

- [ ] **Step 5: Run the tests**

Run: `node --test portal/src/lib/theme.test.mjs`

Expected: PASS, including every pre-existing background and theme test.

- [ ] **Step 6: Commit**

```bash
git add portal/src/lib/theme.js portal/src/lib/theme.test.mjs portal/index.html
git commit -m "feat(portal): a per-user accent color for Classic tiles"
```

---

### Task 3: Carry the accent through the sync layer, and paint the tiles

**Files:**
- Modify: `portal/src/lib/uiPrefs.js`
- Modify: `portal/src/lib/uiPrefsResolve.js`
- Modify: `portal/src/lib/uiPrefsResolve.test.mjs`
- Modify: `portal/src/index.css`
- Modify: `portal/src/components/ToolButton.jsx`
- Modify: `portal/src/components/ToolGrid.jsx`

**Interfaces:**
- Consumes Task 2's exports.
- Produces: `snapshot()` includes `accent`; `resolveHydration` carries it and seeds it from the org default when one is set.

- [ ] **Step 1: Sync layer**

`snapshot()` in `uiPrefs.js` gains `accent: getPrefs().accent`. `hydrateUiPrefs` passes `accent` through its `setPrefs` call.

In `uiPrefsResolve.js`, `resolveHydration` carries `accent` the way it carries `theme`: from `remote` when a saved row exists, otherwise from `orgDefault.accent` falling back to `local.accent`. Unlike the background, the accent IS a reasonable thing for an org default to set, so treat it like `theme`, not like `pinned`.

`hydrateUiPrefs` reads `appearance_default_accent` alongside `appearance_default_theme`.

**Note the irony and get it right:** an `appearance_default_accent` key may already exist in `app_config` from the retired accent setting, holding a value like `signal_red`, which is a NAME and not a hex. `normalizeAccent` rejects it and falls back to the default, so a stale row is harmless. Add a test proving that.

Update `uiPrefsResolve.test.mjs`: add `accent` to the `LOCAL` fixture and add a case asserting a stale non-hex org default is ignored.

- [ ] **Step 2: CSS**

In `portal/src/index.css`, inside the `@theme` block or immediately after it, give the two properties defaults so the pre-paint and no-preference states are correct:

```css
:root {
  --portal-accent: #e53e3e;
  --portal-accent-ink: #ffffff;
}
```

Then add the Classic tile rules. **Scope them so Press never picks them up.** Press styles `.portal-tile` under `[data-theme='press']`; Classic has no `data-theme` attribute at all, so scope with `:root:not([data-theme]) .portal-tile`.

```css
/* Classic tiles take their icon color and hover fill from the user's accent.
   Scoped to :root:not([data-theme]) because Classic is the theme that sets no
   data-theme attribute, and Press must keep its own fixed look. */
:root:not([data-theme]) .portal-tile__icon { color: var(--portal-accent); }

:root:not([data-theme]) .portal-tile:hover,
:root:not([data-theme]) .portal-tile:focus-visible {
  background: var(--portal-accent);
  border-color: var(--portal-accent);
}
:root:not([data-theme]) .portal-tile:hover .portal-tile__icon,
:root:not([data-theme]) .portal-tile:hover .portal-tile__label,
:root:not([data-theme]) .portal-tile:hover .portal-tile__desc,
:root:not([data-theme]) .portal-tile:focus-visible .portal-tile__icon,
:root:not([data-theme]) .portal-tile:focus-visible .portal-tile__label,
:root:not([data-theme]) .portal-tile:focus-visible .portal-tile__desc {
  color: var(--portal-accent-ink);
}
/* The icon sits in a tinted circle; on hover it must not fight the fill. */
:root:not([data-theme]) .portal-tile:hover .portal-tile__icon {
  background: rgb(255 255 255 / 0.18);
}
```

- [ ] **Step 3: Let the CSS win in the components**

Both tile components currently hardcode the icon color and hover tint with Tailwind utilities: `text-wcs-red` on the icon, and `group-hover:bg-wcs-red/10` on the icon circle. Those will fight the new rules.

Remove `text-wcs-red` and `group-hover:bg-wcs-red/10` from the icon circle in BOTH components, so the color comes from the cascade. The SVG inside uses `stroke="currentColor"`, so it inherits correctly once the circle's `color` is set by CSS.

Leave `.portal-tile__label`'s `text-text-primary` and `.portal-tile__desc`'s `text-tile-sub` alone: the hover rules above override them, and the non-hover state should be unchanged.

Verify the star and badge overlays still read against a filled hover background, and say what you found.

- [ ] **Step 4: Verify**

```
node --test portal/src/lib/theme.test.mjs portal/src/lib/uiPrefsResolve.test.mjs
cd portal && npm run build
```

Expected: pass and succeed. Then read back and confirm Press tiles are unaffected, since every new rule is scoped to `:root:not([data-theme])`.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/uiPrefs.js portal/src/lib/uiPrefsResolve.js portal/src/lib/uiPrefsResolve.test.mjs portal/src/index.css portal/src/components/ToolButton.jsx portal/src/components/ToolGrid.jsx
git commit -m "feat(portal): Classic tiles use the accent for icons and hover"
```

---

### Task 4: The Profile control

**Files:**
- Create: `portal/src/components/appearance/AccentPicker.jsx`
- Modify: `portal/src/components/appearance/AppearanceControls.jsx`

**Interfaces:**
- Consumes `ACCENT_PRESETS`, `DEFAULT_ACCENT`, `normalizeAccent`, `accentInk` from `lib/theme`.
- Produces `AccentPicker({ accent, onChange })`. `AppearanceControls({ prefs, onPatch })` keeps its signature.

- [ ] **Step 1: Build the picker**

Create `portal/src/components/appearance/AccentPicker.jsx`:

- A row of preset swatches from `ACCENT_PRESETS`, each a button showing the color, with the current one visibly selected. Give each an `aria-label` of its `label`, and `aria-pressed`.
- A custom color input (`<input type="color">`) for anything not in the palette, with a visible label.
- A small live preview showing a miniature tile in its hover state, using the chosen accent as the background and `accentInk(accent)` as the text color, so the readability guarantee is visible rather than theoretical.
- Copy noting these colors apply to the Classic theme.
- Declare any subcomponent at MODULE SCOPE, not inside the render body. A component declared inside a render body remounts on every render, steals focus and re-fetches. This has been a review finding twice on this codebase.

- [ ] **Step 2: Wire it into AppearanceControls**

Render `AccentPicker` below the theme cards, calling `onPatch({ accent })`.

**Show it only under Classic**, since that is the only theme that reads it. Follow how the previous layout/density block was gated on theme, but gate on Classic rather than hiding it behind an unrelated condition. When Press is selected, either hide the picker or show a one-line note that the accent applies to Classic; pick one and say which.

- [ ] **Step 3: Verify**

```
node --test portal/src/lib/theme.test.mjs portal/src/lib/uiPrefsResolve.test.mjs portal/src/components/appearance/themeOptions.test.mjs
cd portal && npm run build
```

Expected: pass and succeed.

Confirm `ProfileView.jsx` and `AppearanceAdmin.jsx` are unchanged: both render `AppearanceControls` and neither should need editing.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/appearance
git commit -m "feat(portal): pick your tile accent color in Profile"
```
