import { useState, useEffect } from 'react'
import { listBackgrounds, uploadSharedBackground, deleteSharedBackground } from '../../lib/api'
import { downscaleImage, BACKGROUND_MAX_DIMENSION } from '../../lib/downscaleImage'

// Hoisted to module scope so it is a stable component type across renders.
// Declaring this inside the render body would make React remount every
// swatch (losing focus, re-fetching every background image) on each
// re-render triggered by `busy` or `error` changing. Same fix as
// BackgroundPicker.jsx's Swatch.
function Swatch({ style, label }) {
  return (
    <div
      title={label}
      className="relative h-20 w-32 shrink-0 rounded-lg border-2 border-border bg-cover bg-center overflow-hidden"
      style={style}
    />
  )
}

/**
 * Admin twin of BackgroundPicker.jsx's shared-gallery half: manage the pool
 * of images every staff member can pick from on their own profile page.
 * Unlike BackgroundPicker this panel never selects a background for the
 * admin; it only adds to and removes from the shared pool.
 */
export default function SharedBackgroundsAdmin() {
  const [shared, setShared] = useState([])
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''            // so picking the same file twice still fires
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const shrunk = await downscaleImage(file, { maxDimension: BACKGROUND_MAX_DIMENSION })
      await uploadSharedBackground(shrunk)
      await refresh()
    } catch (err) {
      setError(err?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(id) {
    setBusy(true)
    setError('')
    try {
      await deleteSharedBackground(id)
      await refresh()
    } catch (err) {
      setError(err?.message || 'Could not remove that image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-bold text-text-primary">Background gallery</h3>
      <p className="text-xs text-text-muted mt-1 mb-4">
        These images show up as background choices on everyone's profile page,
        alongside their club photo and their own uploads. Add or remove images
        here to change what the whole team can pick from.
      </p>

      {loading ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {shared.length === 0 && (
            <p className="text-sm text-text-muted">No gallery images yet.</p>
          )}
          {shared.map(img => (
            <div key={img.id} className="relative">
              <Swatch style={{ backgroundImage: `url(${img.url})` }} label="Gallery image" />
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
      )}

      <div className="mt-3 flex items-center gap-3">
        <label className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red transition-colors cursor-pointer">
          {busy ? 'Working...' : 'Upload an image'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} disabled={busy} className="hidden" />
        </label>
        <span className="text-xs text-text-muted">JPEG, PNG or WebP.</span>
      </div>

      {error && <p className="text-xs text-wcs-red mt-2">{error}</p>}
    </div>
  )
}
