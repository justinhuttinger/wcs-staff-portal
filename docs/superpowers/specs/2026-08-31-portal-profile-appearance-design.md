# Portal Profile & Appearance

Date: 2026-08-31
Status: approved design, not yet implemented

## Problem

The portal already has a real appearance engine — four themes, five accents,
density, home layout — but only admins can reach it. It sits at Admin → Portal
Setup → Appearance, so a team member cannot change how their own portal looks.

The home background is worse: it is a hardcoded per-location JPEG
(`App.jsx` `LOCATION_BACKGROUNDS`) under a fixed `bg-black/60` scrim. Nobody
can change it, and the only way to add an image is to commit a file to
`portal/public/`.

Separately, the WhenIWork tile is no longer wanted and should come out
everywhere it is wired, not just off the board.

## What already exists

Worth stating plainly, because the naive reading of `lib/theme.js` is wrong.
Its header comment says "Persistence is localStorage. No backend." That comment
is stale.

| Piece | Where | State |
|---|---|---|
| Theme engine (`data-theme` / `data-accent` / `data-density` / `data-layout` on `<html>`) | `portal/src/lib/theme.js` | Done |
| Token blocks per theme | `portal/src/index.css` | Done |
| Picker UI with live swatch previews | `portal/src/components/admin/AppearanceAdmin.jsx` | Done, admin-gated |
| Pre-paint apply (no flash of Classic) | inline script in `portal/index.html` | Done |
| Server persistence: `user_ui_preferences.prefs` JSONB, 4KB cap, whole-object replace | `auth/src/routes/uiPreferences.js` | Done |
| Hydrate-on-login + debounced push, localStorage as mirror | `portal/src/lib/uiPrefs.js` | Done |
| Private-bucket upload pattern (multer memory → Supabase Storage → 1h signed URL) | `auth/src/routes/ticketing.js` | Done, to be copied |
| Admin-writable / all-readable key-value store (`app_config`) | `auth/src/routes/config.js` `/config/app-settings` | Done, to be reused |

So this design adds no new persistence layer. Background preferences are new
keys in the existing `prefs` blob, and the org default is new keys in
`app_config`.

## Scope

In scope: appearance (theme, accent, density, layout) and background photo,
exposed to every user on a page of their own; an admin-managed shared gallery;
an org-wide appearance default; removal of WhenIWork.

Out of scope, decided explicitly: avatar, display name, job title, password
change, session/idle timeout, notification preferences. The profile page is
about how the portal looks, not about identity or account management.

## Delivery

Four independent PRs. The first depends on nothing; 2 → 3 → 4 are ordered.

1. WhenIWork removal
2. Profile view, header entry point, appearance moved out of Admin
3. Background: prefs, gallery, upload
4. Admin gallery management + org default

---

## 1. WhenIWork removal

A full rip-out. The key is threaded through the portal, the auth service, the
seeds, the catalog table and the Electron launcher.

| File | Change |
|---|---|
| `portal/src/config/tools.json` | drop the `wheniwork` entry |
| `portal/src/config/portalTiles.js` | drop from `PORTAL_TILE_CATALOG` |
| `auth/src/routes/admin.js` (~line 45) | drop from `CUSTOM_TILE_KEYS` |
| `auth/seed/seed.js` (~line 19) | drop from `TOOLS` |
| `auth/seed/seed-help-center.js` (~line 33) | reword the "Apps (left side)" sentence |
| `launcher/src/config.js` (~line 47) | drop the URL mapping |
| `launcher/src/main.js` (~lines 356, 486) | drop the tab title and host mapping |
| `launcher/src/credential-capture.js` (~lines 9, 108) | drop the capture host and label |
| `portal/src/components/SaveCredentialToast.jsx` (~line 6) | drop the label |
| `auth/migrations/173_retire_wheniwork.sql` | new — see below |

The migration deletes the catalog row added by `062_catalog_builtin_apps.sql`
and strips the key out of every grant that holds it:

```sql
delete from role_tool_visibility where tool_key = 'wheniwork';
-- plus the equivalent removal from any custom-role grant column that
-- stores tile keys; verify the exact shape against migration 062 and the
-- RBAC v2 schema (057) at implementation time.
```

Stored WhenIWork credentials in the launcher vault are intentionally left in
place rather than deleted — removing the tile should not destroy a saved
password, and the vault has its own admin surface for clearing entries.

The Press nav needs no change: its pinnable app list derives from `lib/apps` →
`tools.json`, and the pin resolver in `App.jsx` already drops keys it cannot
resolve. Anyone holding a WhenIWork pin loses that tab quietly on next load.

**Verification:** `grep -ri wheniwork portal/src auth/src auth/seed launcher/src`
returns nothing. Board renders without the tile. A user whose `visible_tools`
contained the key still loads their board.

---

## 2. Profile view and entry point

### The view

`portal/src/components/ProfileView.jsx`, opened at hash `#profile`, mounted in
`App.jsx` alongside the other `show*` views and cleared by `handleBackToPortal`
like the rest. Three sections:

- **Theme** — the four theme cards with their live previews
- **Layout & Density** — the existing layout and density pickers

PR 2 ships those two only. The Background section is added to this same file
in PR 3; nothing is stubbed in the meantime.

No new gate. Every authenticated user reaches it, so it needs no entry in
`portalTiles.js`, no `CUSTOM_TILE_KEYS` key, and no row in the roles grid.

### Shared preview component

`AppearanceAdmin.jsx` currently owns the `OPTIONS` swatch table and the
`Preview` component. Both move to `portal/src/components/appearance/`:

- `themeOptions.js` — the `OPTIONS`, `LAYOUTS` and `DENSITIES` tables
- `ThemePreview.jsx` — the `Preview` component

`AppearanceAdmin.jsx` and `ProfileView.jsx` both import them. Neither owns a
copy. This matters because each preview renders in its own hardcoded colors
rather than live tokens, so a drifted duplicate would silently show the wrong
thing on one of the two pages.

### Entry point

The header, not a tile. The tile grid is the work surface; a personal-settings
tile competes with it for attention it does not deserve.

- **Classic header** (`App.jsx`, the `<header>` block, ~lines 574-616): the
  `Sign Out` button becomes an initials/avatar button that opens a small menu
  containing **Profile** and **Sign Out**. The existing `bgImage` conditional
  styling carries over — the control has to stay legible over a photo.
- **Press** (`PortalNav.jsx`): the same menu on the right side. `onSignOut`
  becomes `onProfile` + `onSignOut`.

### Admin → Appearance is re-scoped

It stays where it is, but stops being "the only way to change the theme" and
becomes "the default new staff get." It writes `app_config` keys:

```
appearance_default_theme
appearance_default_accent
appearance_default_density
appearance_default_layout
```

`GET /config/app-settings?prefix=appearance_default_` is readable by any
authenticated user, and `PUT` is already `requireRole('admin')`, so no route
work is needed.

`hydrateUiPrefs()` in `lib/uiPrefs.js` changes in one place. Today, an empty
server row means "adopt whatever is in this browser." That becomes: an empty
server row means apply the org default, then push it up. An existing user with
saved prefs is untouched.

**Verification:** unit test that `hydrateUiPrefs` with an empty remote and a set
org default applies the default; with a non-empty remote, ignores the default.
Manually: a team-member account can open Profile and change theme, and the
change survives a reload and appears on a second browser.

---

## 3. Background

### Preference shape

Two new keys in the existing `prefs` blob. No schema change; the 4KB cap is
not remotely threatened by a storage path and an integer.

```js
background: { kind: 'location' | 'gallery' | 'upload' | 'none', value: string }
backgroundDim: 0..80   // percent black overlay
```

Defaults are `{ kind: 'location', value: '' }` and `60`, which reproduce
today's behavior exactly for every user who never opens the section. `60`
is not arbitrary: it is the current hardcoded `bg-black/60`.

Normalization lives next to the theme normalizer in `lib/theme.js` and follows
its rule — an unknown `kind`, a missing `value`, or an out-of-range dim falls
back to the default rather than rendering something broken.

`App.jsx`'s `LOCATION_BACKGROUNDS` map stops being the only source and becomes
the seed of the gallery. The `kind: 'location'` case still reads it, so a user
who never chooses keeps their club's photo.

### Storage

A private `portal-backgrounds` bucket, created on first use exactly as
`ticketing.js` does it (`createBucket(BUCKET, { public: false, fileSizeLimit })`).

- Personal uploads: `{staff_id}/{uuid}.jpg`
- Shared gallery: `shared/{uuid}.jpg`

New route `auth/src/routes/backgrounds.js`, mounted in `auth/src/index.js`:

| Method | Path | Gate | Behavior |
|---|---|---|---|
| GET | `/backgrounds` | authenticated | this user's uploads + the shared gallery, each with a 1h signed URL |
| POST | `/backgrounds` | authenticated | multer memory, 5MB cap, `image/jpeg` `image/png` `image/webp` only; writes under `{staff_id}/` |
| DELETE | `/backgrounds/:id` | authenticated, own row only | path derived from the token's `staff_id`, never from the body |
| POST | `/backgrounds/shared` | `requireRole('admin')` | writes under `shared/` |
| DELETE | `/backgrounds/shared/:id` | `requireRole('admin')` | |

`staff_id` comes from the token and never from the body, matching the rule
`uiPreferences.js` already states for itself. One user cannot write or delete
another's image.

**Each user keeps at most 3 personal uploads; the oldest is pruned on the
fourth.** Without a cap nothing in the system ever deletes an image and the
bucket grows without bound.

### Display

`GET /ui-preferences` gains a `backgroundUrl` field alongside `prefs`: a 1-hour
signed URL minted server-side when `background.kind === 'upload' | 'gallery'`.

A signed URL per load is deliberate, over the alternatives:

- Public bucket — rejected; these are staff-uploaded images, they should not be
  reachable by URL alone.
- Auth-proxy + blob URL, the way `AuthImg.jsx` handles Drive thumbnails —
  workable, since a CSS `background-image` accepts an object URL, but it is
  more moving parts for no gain here. The background is read once at load, so
  a fresh signed URL at hydrate time is sufficient and simpler.

The localStorage mirror stores the *pref*, not the URL. A stale signed URL in
localStorage would 403 on the next load; the mirror therefore holds
`background`/`backgroundDim` only, and the URL is always whatever the most
recent `GET /ui-preferences` returned. On a machine the user has never used,
the first paint shows no background and it appears once hydrate returns — the
same one-load behavior `uiPrefs.js` already documents for the theme.

### Client-side downscale

Upload is preceded by a canvas downscale to max 2560px on the long edge, JPEG
quality 0.82. A 12MP phone photo becomes a few hundred KB.

`portal/src/lib/downscaleImage.js` exists on the unmerged `origin/attach-downscale`
branch. This PR writes its own rather than depending on that branch landing; if
`attach-downscale` merges first, the implementer should import the existing
module instead of adding a second one.

The 5MB server cap stands regardless — a client that skips downscaling must
still be refused.

### The dim control

A slider, 0-80%. It replaces the hardcoded `bg-black/60` div in `App.jsx`
(~line 316) with a computed opacity. At 0 the scrim is gone entirely, which is
the right answer for a dark or low-contrast image and the wrong answer for a
bright one — hence a control rather than a fixed value.

The header already branches on `bgImage` for legibility (white text over a
photo, dark text without). That branch stays as-is and keys off "is there a
background at all", not off the dim level.

**Verification:** unit tests for the background normalizer (unknown kind →
`location`; dim of `-5`, `200`, `'abc'` → 60) and for the upload route
rejecting a 6MB file and a `application/pdf`. Manually: upload, pick, reload,
confirm it persists; sign in on a second browser and confirm it follows.

---

## 4. Admin gallery and org default

`AppearanceAdmin.jsx` gains two panels below the existing pickers:

- **Background Gallery** — upload and remove shared images, hitting
  `POST/DELETE /backgrounds/shared`. This is how the seven club photos become
  managed content instead of static files in `portal/public/`. The existing
  files stay on disk and keep working as the `kind: 'location'` fallback; the
  gallery is additive.
- **Org default** — the theme/accent/density/layout the org gets, written to
  the `appearance_default_*` `app_config` keys described in PR 2.

The distinction to keep clear in the UI copy: the pickers at the top of
AppearanceAdmin still change *the admin's own* appearance (they are the same
component the profile page uses). The org default panel is separate and
explicitly labeled as affecting other people.

---

## Risks

**A user picks an unreadable background.** Mitigated by the dim slider
defaulting to 60 and by the header's existing white-over-photo branch. Not
mitigated further; a user who sets dim to 0 over a white photo can fix it in
the same place they broke it.

**Shared front-desk machines.** Appearance follows the account, so the board
re-skins per whoever is signed in. This is the behavior that already ships for
themes today via `uiPrefs.js`; backgrounds inherit it rather than introducing
it. If it turns out to be a problem at the front desk, the fix is a
kiosk-session opt-out, and that is deliberately not being built up front.

**Bucket growth.** Capped at 3 personal uploads per user with oldest-pruned.
The shared gallery is admin-only and small.

## Open items for implementation

- The exact grant-column shape to strip `wheniwork` from in migration 173 —
  read `062_catalog_builtin_apps.sql` and `057_rbac_v2_schema.sql` before
  writing it.
- Whether the Background section should be hidden under the Spotlight theme,
  whose dark board may not compose with a photo. Decide by looking at it; the
  pref is stored either way so nothing is lost by hiding the control.
