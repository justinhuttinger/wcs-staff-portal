// portal/src/components/AuthImg.jsx
import { useEffect, useState } from 'react'
import { fetchMediaThumbBlob } from '../lib/api'

export default function AuthImg({ driveFileId, alt, className }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url
    let alive = true
    fetchMediaThumbBlob(driveFileId)
      .then((u) => { if (alive) { url = u; setSrc(u) } })
      .catch(() => alive && setFailed(true))
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [driveFileId])
  if (failed) return <div className={(className || '') + ' bg-bg flex items-center justify-center text-tile-sub text-xs'}>no preview</div>
  if (!src) return <div className={(className || '') + ' bg-bg animate-pulse'} />
  return <img src={src} alt={alt || ''} className={className} loading="lazy" />
}
