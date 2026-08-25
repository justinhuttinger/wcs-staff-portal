import { useState, useRef, useMemo, useEffect } from 'react'
import { createAdsManagerAds, previewAdsManagerVariant } from '../../lib/api'
import { CALL_TO_ACTIONS, COPY_LIMITS } from './constants'
import { Modal, Field, TextInput, TextArea, Select, Button, CharCount, ErrorBanner } from './ui'
import { MediaPicker, uploadFiles, useVideoProcessing, assetToVariantFields } from './MediaPicker'
import { isInstantFormAdset, useLeadForms, LeadFormPicker } from './LeadFormPicker'

let variantSeq = 0
function blankVariant(overrides = {}) {
  variantSeq += 1
  return {
    key: `v${variantSeq}`,
    name: '',
    message: '',
    headline: '',
    description: '',
    asset: null,
    ...overrides,
  }
}

// Turns "beach-day_squat rack.jpg" into "Beach Day Squat Rack" so a bulk drop
// produces readable ad names instead of a column of filenames.
function nameFromFile(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
    .slice(0, 60)
}

export default function AdVariantsModal({ adset, campaign, account, onClose, onCreated }) {
  const pages = account.pages || []
  const defaultPage = pages[0] || null

  // An Instant Form ad set has nowhere to send people — the form opens in
  // Facebook — so the builder swaps the destination URL for a form picker.
  const instantForm = isInstantFormAdset(adset)

  const [pageId, setPageId] = useState(defaultPage ? defaultPage.id : '')
  const [link, setLink] = useState('')
  const [leadFormId, setLeadFormId] = useState('')
  const [cta, setCta] = useState(instantForm ? 'SIGN_UP' : 'LEARN_MORE')
  const [status, setStatus] = useState('PAUSED')
  const [advantagePlus, setAdvantagePlus] = useState(false)
  const [variants, setVariants] = useState([blankVariant()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState(null)
  const bulkInputRef = useRef(null)

  const page = pages.find(p => p.id === pageId) || null
  const leadForms = useLeadForms(pageId, instantForm)

  // One form on the Page is the common case; make the obvious choice for them.
  useEffect(() => {
    if (instantForm && !leadFormId && leadForms.forms.length === 1) {
      setLeadFormId(leadForms.forms[0].id)
    }
  }, [instantForm, leadFormId, leadForms.forms])

  // Patch a processed video back into whichever variant is holding it.
  useVideoProcessing(
    variants.map(v => v.asset).filter(Boolean),
    ready => setVariants(list => list.map(v => (
      v.asset && v.asset.video_id === ready.video_id ? { ...v, asset: ready } : v
    )))
  )

  function patch(key, changes) {
    setVariants(list => list.map(v => (v.key === key ? { ...v, ...changes } : v)))
  }

  function addVariant() {
    setVariants(list => [...list, blankVariant()])
  }

  // Copying a variant keeps the copy and drops the media — the common move is
  // "same words, different image", and the reverse is one click away.
  function duplicateVariant(key) {
    setVariants(list => {
      const src = list.find(v => v.key === key)
      if (!src) return list
      const idx = list.findIndex(v => v.key === key)
      const copy = blankVariant({
        name: src.name ? `${src.name} v${list.length + 1}` : '',
        message: src.message,
        headline: src.headline,
        description: src.description,
        asset: null,
      })
      return [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)]
    })
  }

  function removeVariant(key) {
    setVariants(list => (list.length === 1 ? list : list.filter(v => v.key !== key)))
  }

  // The bulk path: every dropped file becomes its own variant, inheriting the
  // copy of the first filled-in row so only the media differs by default.
  async function handleBulkFiles(files) {
    const list = Array.from(files || [])
    if (!list.length) return
    setError('')
    try {
      const { assets, rejected } = await uploadFiles(list)
      if (rejected.length) setError(`Meta rejected: ${rejected.join(', ')}`)
      if (!assets.length) return

      setVariants(current => {
        const template = current.find(v => v.message || v.headline) || current[0] || blankVariant()
        const fresh = assets.map((asset, i) => blankVariant({
          name: nameFromFile(list[i] && list[i].name) || `Variant ${current.length + i + 1}`,
          message: template.message,
          headline: template.headline,
          description: template.description,
          asset,
        }))
        // An untouched starter row is scaffolding, not content — drop it.
        const keep = current.filter(v => v.name || v.message || v.headline || v.asset)
        return [...keep, ...fresh]
      })
    } catch (err) {
      setError(err.message)
    }
  }

  function sharedPayload() {
    return {
      adset_id: adset.id,
      page_id: pageId,
      instagram_user_id: page && page.instagram_id ? page.instagram_id : undefined,
      link: link.trim(),
      lead_gen_form_id: instantForm ? leadFormId : undefined,
      call_to_action: cta,
      status,
      advantage_plus: advantagePlus,
    }
  }

  async function showPreview(variant) {
    setPreview({ key: variant.key, loading: true, html: null, error: '' })
    try {
      const res = await previewAdsManagerVariant({
        variant: {
          name: variant.name,
          message: variant.message,
          headline: variant.headline,
          description: variant.description,
          ...assetToVariantFields(variant.asset),
        },
        shared: sharedPayload(),
      })
      setPreview({ key: variant.key, loading: false, html: res.html, error: '' })
    } catch (err) {
      setPreview({ key: variant.key, loading: false, html: null, error: err.message })
    }
  }

  const problems = useMemo(() => {
    const list = []
    if (!pageId) list.push('Pick a Facebook Page')
    if (instantForm) {
      if (!leadFormId) list.push('Choose the Instant form this ad opens')
      else if (!/^\d{6,}$/.test(leadFormId.trim())) list.push('The Instant form ID should be all digits')
    }
    // Even a form ad carries a link, and on a lead ad Meta insists it points
    // off Facebook.
    if (!link.trim()) list.push(instantForm ? 'Add your website link' : 'Add a destination link')
    else if (!/^https?:\/\//i.test(link.trim())) list.push('The link needs to start with http:// or https://')
    else if (instantForm && /^https?:\/\/([^/]*\.)?(facebook|fb)\.(com|me)(\/|$)/i.test(link.trim())) {
      list.push('A lead ad cannot link to a Facebook Page — use your website')
    }
    variants.forEach((v, i) => {
      const label = v.name || `Variant ${i + 1}`
      if (!v.name.trim()) list.push(`${label}: needs a name`)
      if (!v.asset) list.push(`${label}: needs an image or video`)
      else if (v.asset.kind === 'video' && !v.asset.ready) list.push(`${label}: video is still processing`)
    })
    return list
  }, [pageId, link, leadFormId, instantForm, variants])

  async function submit() {
    if (problems.length) return
    setSaving(true)
    setError('')
    try {
      const res = await createAdsManagerAds({
        ...sharedPayload(),
        variants: variants.map(v => ({
          name: v.name.trim(),
          message: v.message,
          headline: v.headline,
          description: v.description,
          ...assetToVariantFields(v.asset),
        })),
      })
      setResults(res)
      if (res.created > 0) onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // After a submit the modal becomes a receipt: per-variant success or the
  // exact Meta complaint, so a partial batch is obvious and fixable.
  if (results) {
    return (
      <Modal
        title={results.failed ? `Created ${results.created}, ${results.failed} failed` : `Created ${results.created} ad${results.created === 1 ? '' : 's'}`}
        subtitle={`In ad set “${adset.name}”`}
        onClose={onClose}
        wide
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <ul className="space-y-2">
          {results.results.map((r, i) => (
            <li key={i} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${r.ok ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/25 bg-red-500/5'}`}>
              <span className={`text-sm font-bold ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>{r.ok ? '✓' : '✕'}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{r.name}</p>
                <p className="text-xs text-text-muted break-words">{r.ok ? `Ad ${r.ad_id} — ${status === 'ACTIVE' ? 'active' : 'paused'}` : r.error}</p>
              </div>
            </li>
          ))}
        </ul>
        {status === 'PAUSED' && results.created > 0 && (
          <p className="text-xs text-text-muted">
            New ads are paused. Turn them on from the Ads column when you are ready to spend.
          </p>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      title="New ads"
      subtitle={`${campaign ? campaign.name + ' → ' : ''}${adset.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-text-muted">
            {variants.length} ad{variants.length === 1 ? '' : 's'} will be created
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || problems.length > 0}>
            {saving ? 'Creating…' : `Create ${variants.length} ad${variants.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {/* Shared across every variant — the whole point is that only copy and
          media differ, so these live once at the top. */}
      <section className="rounded-xl border border-border bg-bg/60 p-4 space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Shared by all variants</h4>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Facebook Page" required hint={page && page.instagram_id ? `Instagram: @${page.instagram_username}` : 'No Instagram account linked to this Page'}>
            <Select
              value={pageId}
              onChange={e => setPageId(e.target.value)}
              options={[{ value: '', label: 'Select a Page…' }, ...pages.map(p => ({ value: p.id, label: p.name }))]}
            />
          </Field>
          <Field label="Call to action">
            <Select value={cta} onChange={e => setCta(e.target.value)} options={CALL_TO_ACTIONS} />
          </Field>
        </div>
        {instantForm && (
          <LeadFormPicker
            pageId={pageId}
            forms={leadForms.forms}
            loading={leadForms.loading}
            error={leadForms.error}
            restricted={leadForms.restricted}
            message={leadForms.message}
            value={leadFormId}
            onChange={setLeadFormId}
          />
        )}
        <Field
          label={instantForm ? 'Website link' : 'Destination link'}
          required
          hint={instantForm
            ? 'Nobody lands here — the form opens in Facebook — but Meta rejects a lead ad whose link points at a Facebook Page.'
            : 'Where the ad sends people'}
        >
          <TextInput
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="https://westcoaststrength.com/…"
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Start as">
            <Select
              value={status}
              onChange={e => setStatus(e.target.value)}
              options={[{ value: 'PAUSED', label: 'Paused (review first)' }, { value: 'ACTIVE', label: 'Active (start spending)' }]}
            />
          </Field>
          <label className="flex items-start gap-2 pt-6">
            <input
              type="checkbox"
              checked={advantagePlus}
              onChange={e => setAdvantagePlus(e.target.checked)}
              className="mt-0.5 accent-wcs-red"
            />
            <span className="text-xs text-text-muted">
              <span className="font-semibold text-text-primary block">Advantage+ enhancements</span>
              Lets Meta rewrite copy and crop images. Off keeps each variant exactly as written — better for a clean test.
            </span>
          </label>
        </div>
      </section>

      {/* Bulk drop: one variant per file. */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleBulkFiles(e.dataTransfer.files) }}
        onClick={() => bulkInputRef.current && bulkInputRef.current.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragOver ? 'border-wcs-red bg-wcs-red/5' : 'border-border hover:border-wcs-red/40'}`}
      >
        <p className="text-sm font-semibold text-text-primary">Drop images or videos here to make one ad each</p>
        <p className="text-xs text-text-muted mt-0.5">They inherit the copy from your first variant. Edit any of them below.</p>
        <input
          ref={bulkInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={e => { handleBulkFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Variants</h4>
          <Button variant="secondary" onClick={addVariant} className="!py-1 !px-3 !text-xs">+ Add variant</Button>
        </div>

        {variants.map((v, i) => (
          <div key={v.key} className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Variant {i + 1}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => showPreview(v)} className="text-xs text-text-muted hover:text-text-primary">Preview</button>
                <button onClick={() => duplicateVariant(v.key)} className="text-xs text-text-muted hover:text-text-primary">Duplicate</button>
                <button
                  onClick={() => removeVariant(v.key)}
                  disabled={variants.length === 1}
                  className="text-xs text-text-muted hover:text-red-600 disabled:opacity-30"
                >Remove</button>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="shrink-0">
                <MediaPicker asset={v.asset} onChange={asset => patch(v.key, { asset })} compact />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <Field label="Ad name" required>
                  <TextInput
                    value={v.name}
                    onChange={e => patch(v.key, { name: e.target.value })}
                    placeholder={`e.g. 7 Day Trial — ${i === 0 ? 'Squat Rack' : 'Variant ' + (i + 1)}`}
                  />
                </Field>
                <Field label={<>Primary text</>}>
                  <TextArea
                    rows={3}
                    value={v.message}
                    onChange={e => patch(v.key, { message: e.target.value })}
                    placeholder="The main body copy people read first."
                  />
                </Field>
                <div className="flex justify-end -mt-2">
                  <CharCount value={v.message} limit={COPY_LIMITS.message} />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Field label="Headline">
                      <TextInput value={v.headline} onChange={e => patch(v.key, { headline: e.target.value })} placeholder="Bold text under the image" />
                    </Field>
                    <div className="flex justify-end mt-1"><CharCount value={v.headline} limit={COPY_LIMITS.headline} /></div>
                  </div>
                  <div>
                    <Field label="Description">
                      <TextInput value={v.description} onChange={e => patch(v.key, { description: e.target.value })} placeholder="Small text beside the button" />
                    </Field>
                    <div className="flex justify-end mt-1"><CharCount value={v.description} limit={COPY_LIMITS.description} /></div>
                  </div>
                </div>
              </div>
            </div>

            {preview && preview.key === v.key && (
              <div className="rounded-lg border border-border bg-bg p-3">
                {preview.loading && <p className="text-xs text-text-muted">Rendering preview…</p>}
                {preview.error && <p className="text-xs text-red-600">{preview.error}</p>}
                {preview.html && (
                  <div className="overflow-x-auto">
                    <iframe
                      title="Ad preview"
                      srcDoc={preview.html}
                      className="w-[360px] h-[560px] border-0"
                      sandbox="allow-scripts allow-same-origin"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">Before you can create these:</p>
          <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
            {problems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
            {problems.length > 6 && <li>…and {problems.length - 6} more</li>}
          </ul>
        </div>
      )}
    </Modal>
  )
}
