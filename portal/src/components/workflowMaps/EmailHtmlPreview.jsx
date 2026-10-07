import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MERGE_FIELD_RE } from './kinds'

export const PREVIEW_WIDTHS = { desktop: 640, phone: 375 }

// Rough check used to offer the HTML view when someone pastes markup into a
// plain-text body.
export function looksLikeHtml(text) {
  return /<(html|body|table|div|p|a|img|br|span|h[1-6])[\s>/]/i.test(text || '')
}

const MERGE_STYLE = 'background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:0 2px;font-weight:600'

// Pasted email HTML, cleaned for preview: scripts, event handlers and
// javascript: links are stripped (the frame can't run scripts anyway), links
// open in a new tab, and merge fields in the text are highlighted. Merge
// fields inside attributes (e.g. href="{{trigger_link...}}") are left alone.
export function previewDocument(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  doc.querySelectorAll('script, iframe, object, embed, form, base').forEach(el => el.remove())
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const hits = []
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (n.parentElement?.closest('style, title')) continue
    MERGE_FIELD_RE.lastIndex = 0
    if (MERGE_FIELD_RE.test(n.nodeValue)) hits.push(n)
  }
  for (const n of hits) {
    const frag = doc.createDocumentFragment()
    String(n.nodeValue).split(MERGE_FIELD_RE).forEach((part, i) => {
      if (!part) return
      if (i % 2 === 1) {
        const span = doc.createElement('span')
        span.setAttribute('style', MERGE_STYLE)
        span.textContent = part
        frag.appendChild(span)
      } else {
        frag.appendChild(doc.createTextNode(part))
      }
    })
    n.replaceWith(frag)
  }
  const base = doc.createElement('base')
  base.setAttribute('target', '_blank')
  doc.head.prepend(base)
  return '<!doctype html>' + doc.documentElement.outerHTML
}

// The rendered email, scaled down to fit its container. Sandboxed with no
// scripts; same-origin is allowed only so the frame's height can be measured.
export default function EmailHtmlPreview({ html, width = 'desktop', onClick }) {
  const frameWidth = PREVIEW_WIDTHS[width] || PREVIEW_WIDTHS.desktop
  const wrapRef = useRef(null)
  const frameRef = useRef(null)
  const [boxWidth, setBoxWidth] = useState(frameWidth)
  const [height, setHeight] = useState(400)
  // A fixed-width email wider than the target (e.g. a 600px table plus
  // padding on a phone) widens the frame and gets scaled down to fit, the way
  // mail apps shrink it, instead of showing scrollbars.
  const [contentWidth, setContentWidth] = useState(frameWidth)
  const srcDoc = useMemo(() => previewDocument(html), [html])
  const effWidth = Math.max(frameWidth, contentWidth)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function measure() {
    const root = frameRef.current?.contentDocument?.documentElement
    if (!root) return
    // scrollHeight never reports less than the frame's own height, so collapse
    // the frame for the read or it could only ever grow.
    const frame = frameRef.current
    const prev = frame.style.height
    frame.style.height = '1px'
    const h = root.scrollHeight
    frame.style.height = prev
    setContentWidth(root.scrollWidth)
    setHeight(Math.max(120, h))
    // Images load after the frame does; re-measure as each one lands.
    root.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', measure, { once: true })
    })
  }

  // New target width: start from it again, then re-measure as text reflows.
  useEffect(() => { setContentWidth(frameWidth) }, [frameWidth])
  useEffect(() => { requestAnimationFrame(measure) }, [effWidth])

  const scale = Math.min(1, boxWidth / effWidth)
  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border border-border bg-white relative" style={{ height: height * scale }}>
      <iframe
        ref={frameRef}
        title="Email preview"
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        scrolling="no"
        onLoad={measure}
        className="border-0 origin-top-left block"
        style={{ width: effWidth, height, transform: `scale(${scale})`, marginLeft: scale === 1 ? Math.max(0, (boxWidth - effWidth) / 2) : 0 }}
      />
      {onClick && (
        <button type="button" onClick={onClick} className="absolute inset-0 w-full h-full cursor-zoom-in" aria-label="Open full-size preview" />
      )}
    </div>
  )
}

export function WidthToggle({ value, onChange }) {
  return (
    <div className="flex gap-1 bg-bg rounded-lg p-1">
      {[['desktop', 'Desktop'], ['phone', 'Phone']].map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${value === k ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>{l}</button>
      ))}
    </div>
  )
}

// Full-screen preview with the subject line on top, like an inbox.
export function EmailPreviewModal({ subject, previewText, html, onClose }) {
  const [width, setWidth] = useState('desktop')
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/50 flex flex-col items-center p-3 sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface rounded-xl border border-border shadow-xl w-full flex flex-col min-h-0 max-h-full" style={{ maxWidth: PREVIEW_WIDTHS[width] + 48 }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-text-primary truncate">{subject || '(no subject)'}</div>
            {previewText && <div className="text-xs text-text-muted truncate">{previewText}</div>}
          </div>
          <WidthToggle value={width} onChange={setWidth} />
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none px-1" aria-label="Close preview">&times;</button>
        </div>
        <div className="overflow-y-auto p-3 sm:p-6 bg-bg rounded-b-xl">
          <EmailHtmlPreview html={html} width={width} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
