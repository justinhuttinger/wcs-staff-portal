import { useState, useEffect, useRef } from 'react'
import {
  uploadAdsManagerImages, uploadAdsManagerVideo, getAdsManagerVideoStatus,
  getAdsManagerImages, getAdsManagerVideos,
} from '../../lib/api'
import { Modal, Button, Spinner, EmptyState, ErrorBanner } from './ui'

// Media travels through this screen as one normalised shape so every consumer
// (variant rows, the edit modal, the preview call) reads the same fields:
//   { kind: 'image', hash, url, name }
//   { kind: 'video', video_id, thumbnail_url, ready, name }

export function imageAsset(img) {
  return { kind: 'image', hash: img.hash, url: img.url, name: img.name || 'Image' }
}

export function videoAsset(vid, extra = {}) {
  return {
    kind: 'video',
    video_id: vid.id,
    thumbnail_url: vid.picture || vid.thumbnail_url || null,
    ready: extra.ready !== undefined ? extra.ready : true,
    name: vid.title || vid.name || 'Video',
  }
}

// Maps an asset onto the fields the create/preview API expects.
export function assetToVariantFields(asset) {
  if (!asset) return {}
  if (asset.kind === 'video') {
    return { video_id: asset.video_id, thumbnail_url: asset.thumbnail_url || undefined }
  }
  return { image_hash: asset.hash }
}

export async function uploadFiles(files) {
  const list = Array.from(files || [])
  const images = list.filter(f => f.type.startsWith('image/'))
  const videos = list.filter(f => f.type.startsWith('video/'))
  const rejected = list.filter(f => !f.type.startsWith('image/') && !f.type.startsWith('video/'))

  const assets = []
  if (images.length) {
    const res = await uploadAdsManagerImages(images)
    for (const img of res.images || []) {
      // Meta returns a null hash for anything it refused (wrong format, too
      // small); surface those rather than creating a broken variant.
      if (img.hash) assets.push(imageAsset(img))
      else rejected.push({ name: img.name })
    }
  }
  // Videos upload one at a time — each is a large multipart body and Meta
  // throttles concurrent uploads on the same ad account.
  for (const file of videos) {
    const res = await uploadAdsManagerVideo(file)
    assets.push({ kind: 'video', video_id: res.id, name: res.name, ready: false, thumbnail_url: null })
  }
  return { assets, rejected: rejected.map(f => f.name).filter(Boolean) }
}

// Videos are unusable until Meta finishes transcoding. This polls every asset
// still marked pending and patches it in place once it is ready.
export function useVideoProcessing(assets, onAssetReady) {
  const readyRef = useRef(onAssetReady)
  readyRef.current = onAssetReady

  useEffect(() => {
    const pending = assets.filter(a => a && a.kind === 'video' && !a.ready)
    if (!pending.length) return
    let alive = true

    const timer = setInterval(async () => {
      for (const asset of pending) {
        if (!alive) return
        try {
          const status = await getAdsManagerVideoStatus(asset.video_id)
          if (status.ready && alive) {
            readyRef.current({ ...asset, ready: true, thumbnail_url: status.thumbnail_url })
          }
        } catch {
          // Transient poll failures are fine — the next tick retries.
        }
      }
    }, 4000)

    return () => { alive = false; clearInterval(timer) }
    // Re-runs whenever the set of pending video ids changes.
  }, [assets.map(a => (a && a.kind === 'video' && !a.ready ? a.video_id : '')).join(',')])
}

export function MediaThumb({ asset, className = '' }) {
  if (!asset) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed border-border bg-bg text-[10px] text-text-muted ${className}`}>
        No media
      </div>
    )
  }
  const src = asset.kind === 'video' ? asset.thumbnail_url : asset.url
  if (!src) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-border bg-bg ${className}`}>
        <span className="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
        <span className="text-[9px] text-text-muted">Processing</span>
      </div>
    )
  }
  return (
    <div className={`relative rounded-lg overflow-hidden border border-border bg-bg ${className}`}>
      <img src={src} alt={asset.name || ''} className="w-full h-full object-cover" />
      {asset.kind === 'video' && (
        <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/70 text-white text-[9px] font-bold">
          {asset.ready ? 'VIDEO' : '…'}
        </span>
      )}
    </div>
  )
}

// Per-variant control: upload a replacement or reach into the account library.
export function MediaPicker({ asset, onChange, compact }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const inputRef = useRef(null)

  async function handleFiles(files) {
    if (!files || !files.length) return
    setBusy(true)
    setError('')
    try {
      const { assets, rejected } = await uploadFiles([files[0]])
      if (assets[0]) onChange(assets[0])
      if (rejected.length) setError(`Meta rejected ${rejected.join(', ')}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <div className="flex items-center gap-2">
        <MediaThumb asset={asset} className={compact ? 'w-14 h-14 shrink-0' : 'w-20 h-20 shrink-0'} />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current && inputRef.current.click()}
            className="text-xs font-semibold text-wcs-red hover:underline disabled:opacity-50 text-left"
          >{busy ? 'Uploading…' : asset ? 'Replace' : 'Upload'}</button>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="text-xs text-text-muted hover:text-text-primary text-left"
          >Choose existing</button>
        </div>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
      {libraryOpen && (
        <MediaLibraryModal
          onPick={a => { onChange(a); setLibraryOpen(false) }}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  )
}

// Everything already uploaded to this ad account. The point is re-mixing:
// pairing yesterday's image with today's headline without a re-upload.
export function MediaLibraryModal({ onPick, onClose }) {
  const [tab, setTab] = useState('images')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    const load = tab === 'images' ? getAdsManagerImages({ limit: 100 }) : getAdsManagerVideos({ limit: 50 })
    load
      .then(res => {
        if (!alive) return
        const data = res.data || []
        setItems(tab === 'images' ? data.map(imageAsset) : data.map(v => videoAsset(v)))
      })
      .catch(err => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tab])

  return (
    <Modal title="Media library" subtitle="Everything uploaded to this ad account" onClose={onClose} wide>
      <div className="flex gap-1 bg-bg rounded-lg p-1 w-fit">
        {[{ key: 'images', label: 'Images' }, { key: 'videos', label: 'Videos' }].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === t.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
          >{t.label}</button>
        ))}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="Upload media from an ad variant and it will show up here." />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 max-h-[55vh] overflow-y-auto">
          {items.map(asset => (
            <button
              key={asset.hash || asset.video_id}
              onClick={() => onPick(asset)}
              className="group text-left"
            >
              <MediaThumb asset={asset} className="w-full aspect-square group-hover:ring-2 group-hover:ring-wcs-red/40 transition" />
              <p className="text-[10px] text-text-muted mt-1 truncate">{asset.name}</p>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
