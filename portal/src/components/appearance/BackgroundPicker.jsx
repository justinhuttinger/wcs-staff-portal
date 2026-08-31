import { useState, useEffect } from 'react'
import { listBackgrounds, uploadBackground, deleteBackground } from '../../lib/api'
import { downscaleImage, BACKGROUND_MAX_DIMENSION } from '../../lib/downscaleImage'

// Hoisted to module scope so it is a stable component type across renders.
// Declaring this inside BackgroundPicker's body would make React remount
// every swatch (losing focus, re-fetching every background-image) on each
// re-render triggered by `busy` or `error` changing.
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

/**
 * Pick the home-screen background: the club photo (the default, and what the
 * portal has always shown), a shared gallery image, one of your own uploads,
 * or nothing.
 *
 * The dim slider replaces the black/60 scrim App.jsx used to hardcode. It is a
 * control rather than a constant because the right amount depends entirely on
 * the photo: a dark gym shot needs none, a bright one needs most of it.
 */
export default function BackgroundPicker({ background, backgroundDim, onPatch, onBackgroundUrlChange, locationLabel }) {
  const [mine, setMine] = useState([])
  const [shared, setShared] = useState([])
  // Null until GET /backgrounds answers with the real cap, so the copy below
  // never states a number the client invented (the server owns MAX_PER_USER).
  const [maxPerUser, setMaxPerUser] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Selecting an image needs to repaint the shell immediately, but App owns
  // the signed-URL state (it also feeds the login screen and other views).
  // This picker already has the URL for everything it renders, so it is
  // simplest to just hand it up rather than have App re-fetch or re-derive
  // it. `onPatch` still carries the id, which is what gets persisted; the URL
  // itself is never sent to the server or stored anywhere.
  function choose(nextBackground, url) {
    onPatch({ background: nextBackground })
    onBackgroundUrlChange?.(url)
  }

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
      const shrunk = await downscaleImage(file, { maxDimension: BACKGROUND_MAX_DIMENSION })
      const r = await uploadBackground(shrunk)
      await refresh()
      // The upload response already carries a signed URL for the new image,
      // and this picker auto-selects it, so repaint the shell right away.
      choose({ kind: 'upload', value: r.image.id }, r.image.url)
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
        choose({ kind: 'location', value: '' }, null)
      }
      await refresh()
    } catch {
      setError('Could not remove that image.')
    } finally {
      setBusy(false)
    }
  }

  const isSelected = (kind, value) => background.kind === kind && background.value === value

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Background</p>
        <div className="flex flex-wrap gap-3">
          <Swatch
            selected={background.kind === 'location'}
            onClick={() => choose({ kind: 'location', value: '' }, null)}
            label={`Your club photo${locationLabel ? ` (${locationLabel})` : ''}`}
          >
            <span className="absolute inset-0 flex items-center justify-center bg-bg text-[11px] font-semibold text-text-muted px-2 text-center">
              Club photo
            </span>
          </Swatch>

          <Swatch
            selected={background.kind === 'none'}
            onClick={() => choose({ kind: 'none', value: '' }, null)}
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
              onClick={() => choose({ kind: 'gallery', value: img.id }, img.url)}
              style={{ backgroundImage: `url(${img.url})` }}
              label="Gallery image"
            />
          ))}

          {mine.map(img => (
            <div key={img.id} className="relative">
              <Swatch
                selected={isSelected('upload', img.id)}
                onClick={() => choose({ kind: 'upload', value: img.id }, img.url)}
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
          {maxPerUser != null && (
            <span className="text-xs text-text-muted">
              JPEG, PNG or WebP. You can keep {maxPerUser}; the oldest is replaced after that.
            </span>
          )}
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
