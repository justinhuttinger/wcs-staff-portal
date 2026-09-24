import { useState, useRef, useMemo, useEffect } from 'react'
import { createAdsManagerFlexibleAd, previewAdsManagerVariant, updateAdsManagerAdset } from '../../lib/api'
import { CALL_TO_ACTIONS, COPY_LIMITS, FLEX_LIMITS } from './constants'
import { Modal, Field, TextInput, TextArea, Select, Button, CharCount, ErrorBanner } from './ui'
import { MediaPicker, uploadFiles, useVideoProcessing, assetToVariantFields } from './MediaPicker'
import { isInstantFormAdset, needsInstantFormSwitch, useLeadForms, LeadFormPicker } from './LeadFormPicker'

// "One ad, many versions". The sibling of AdVariantsModal: that one makes one
// ad per variant, this one makes ONE ad holding every image, video and line of
// copy, and Meta mixes them. Built on Meta's Dynamic Creative, so the ad set
// has to have been created for it and holds exactly one ad.

let mediaSeq = 0
function mediaSlot(asset) {
  mediaSeq += 1
  return { key: `m${mediaSeq}`, asset }
}

// A stack of alternatives for one copy field: add, remove, and a live count
// against Meta's cap. The soft limit is where Meta starts truncating; the hard
// limit is where it refuses the ad.
function VersionList({ label, values, onChange, max, softLimit, hardLimit, multiline, placeholder }) {
  function set(i, text) {
    onChange(values.map((v, idx) => (idx === i ? text : v)))
  }
  function remove(i) {
    onChange(values.length === 1 ? [''] : values.filter((_, idx) => idx !== i))
  }
  const Input = multiline ? TextArea : TextInput

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">
          {label} <span className="font-normal text-text-muted tabular-nums">{values.length}/{max}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange([...values, ''])}
          disabled={values.length >= max}
          className="text-xs font-semibold text-wcs-red hover:underline disabled:text-text-muted disabled:no-underline disabled:cursor-not-allowed"
        >+ Add {label.toLowerCase()}</button>
      </div>
      {values.map((v, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start gap-2">
            <Input
              {...(multiline ? { rows: 3 } : {})}
              value={v}
              maxLength={hardLimit}
              onChange={e => set(i, e.target.value)}
              placeholder={i === 0 ? placeholder : `Version ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={values.length === 1 && !v}
              className="text-text-muted hover:text-red-600 text-lg leading-none pt-2 disabled:opacity-30"
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            >×</button>
          </div>
          <div className="flex justify-end pr-6"><CharCount value={v} limit={softLimit} /></div>
        </div>
      ))}
    </div>
  )
}

export default function FlexibleAdModal({ adset, campaign, account, hasAds, onClose, onCreated }) {
  const pages = account.pages || []
  const defaultPage = pages[0] || null

  // Same Instant Form handling as the variant builder.
  const [switched, setSwitched] = useState(false)
  const instantForm = switched || isInstantFormAdset(adset)
  const needsSwitch = !switched && needsInstantFormSwitch(adset)
  const [switching, setSwitching] = useState(false)
  // Meta only takes this kind of ad in an ad set created with Dynamic Creative
  // on, and that cannot be switched on later.
  const dynamic = adset.is_dynamic_creative === true

  const [name, setName] = useState('')
  const [pageId, setPageId] = useState(defaultPage ? defaultPage.id : '')
  const [link, setLink] = useState('')
  const [leadFormId, setLeadFormId] = useState('')
  const [cta, setCta] = useState(instantForm ? 'SIGN_UP' : 'LEARN_MORE')
  const [status, setStatus] = useState('PAUSED')
  const [media, setMedia] = useState([])
  const [bodies, setBodies] = useState([''])
  const [titles, setTitles] = useState([''])
  const [descriptions, setDescriptions] = useState([''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState(null)
  const bulkInputRef = useRef(null)

  const page = pages.find(p => p.id === pageId) || null
  const leadForms = useLeadForms(pageId, instantForm)

  useEffect(() => {
    if (instantForm && !leadFormId && leadForms.forms.length === 1) {
      setLeadFormId(leadForms.forms[0].id)
    }
  }, [instantForm, leadFormId, leadForms.forms])

  useVideoProcessing(
    media.map(m => m.asset),
    ready => setMedia(list => list.map(m => (
      m.asset.video_id === ready.video_id ? { ...m, asset: ready } : m
    )))
  )

  async function switchToInstantForm() {
    setSwitching(true)
    setError('')
    try {
      await updateAdsManagerAdset(adset.id, { destination_type: 'ON_AD' })
      setSwitched(true)
      setCta('SIGN_UP')
    } catch (err) {
      setError(err.message)
    } finally {
      setSwitching(false)
    }
  }

  async function handleBulkFiles(files) {
    const list = Array.from(files || [])
    if (!list.length) return
    setError('')
    try {
      const { assets, rejected } = await uploadFiles(list)
      if (rejected.length) setError(`Meta rejected: ${rejected.join(', ')}`)
      if (assets.length) setMedia(current => [...current, ...assets.map(mediaSlot)])
    } catch (err) {
      setError(err.message)
    }
  }

  const texts = list => list.map(t => t.trim()).filter(Boolean)
  const imageCount = media.filter(m => m.asset.kind !== 'video').length
  const videoCount = media.filter(m => m.asset.kind === 'video').length
  const assetTotal = media.length + texts(bodies).length + texts(titles).length +
    texts(descriptions).length + FLEX_LIMITS.fixed

  function payload() {
    return {
      adset_id: adset.id,
      name: name.trim(),
      page_id: pageId,
      instagram_user_id: page && page.instagram_id ? page.instagram_id : undefined,
      link: link.trim(),
      lead_gen_form_id: instantForm ? leadFormId : undefined,
      call_to_action: cta,
      status,
      media: media.map(m => assetToVariantFields(m.asset)),
      bodies: texts(bodies),
      titles: texts(titles),
      descriptions: texts(descriptions),
    }
  }

  // Meta renders one combination at a time, so preview the first of each:
  // enough to check the look and the button before creating.
  async function showPreview() {
    setPreview({ loading: true, html: null, error: '' })
    const p = payload()
    try {
      const res = await previewAdsManagerVariant({
        variant: {
          name: p.name,
          message: p.bodies[0] || '',
          headline: p.titles[0],
          description: p.descriptions[0],
          ...(media[0] ? assetToVariantFields(media[0].asset) : {}),
        },
        shared: p,
      })
      setPreview({ loading: false, html: res.html, error: '' })
    } catch (err) {
      setPreview({ loading: false, html: null, error: err.message })
    }
  }

  const problems = useMemo(() => {
    const list = []
    if (!dynamic) list.push('Pick an ad set created for one ad, many versions')
    else if (hasAds) list.push('This ad set already has its ad')
    if (!name.trim()) list.push('Give the ad a name')
    if (!pageId) list.push('Pick a Facebook Page')
    if (needsSwitch) list.push('Switch this ad set to Instant Form first')
    if (instantForm) {
      if (!leadFormId) list.push('Choose the Instant form this ad opens')
      else if (!/^\d{6,}$/.test(leadFormId.trim())) list.push('The Instant form ID should be all digits')
    }
    if (!link.trim()) list.push(instantForm ? 'Add your website link' : 'Add a destination link')
    else if (!/^https?:\/\//i.test(link.trim())) list.push('The link needs to start with http:// or https://')
    else if (instantForm && /^https?:\/\/([^/]*\.)?(facebook|fb)\.(com|me)(\/|$)/i.test(link.trim())) {
      list.push('A lead ad cannot link to a Facebook Page. Use your website.')
    }
    if (!media.length) list.push('Add at least one image or video')
    if (imageCount > FLEX_LIMITS.media) list.push(`At most ${FLEX_LIMITS.media} images`)
    if (videoCount > FLEX_LIMITS.media) list.push(`At most ${FLEX_LIMITS.media} videos`)
    if (media.some(m => m.asset.kind === 'video' && !m.asset.ready)) list.push('A video is still processing')
    if (!texts(bodies).length) list.push('Add at least one primary text')
    if (assetTotal > FLEX_LIMITS.total) list.push(`${assetTotal} of ${FLEX_LIMITS.total} assets used. Drop some media or text.`)
    return list
  }, [dynamic, hasAds, name, pageId, needsSwitch, instantForm, leadFormId, link, media, imageCount, videoCount, bodies, assetTotal])

  async function submit() {
    if (problems.length) return
    setSaving(true)
    setError('')
    try {
      const res = await createAdsManagerFlexibleAd(payload())
      setResult(res)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <Modal
        title="Created 1 ad"
        subtitle={`In ad set “${adset.name}”`}
        onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
          <span className="text-sm font-bold text-emerald-600">✓</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">{result.name}</p>
            <p className="text-xs text-text-muted break-words">
              Ad {result.ad_id}, {status === 'ACTIVE' ? 'active' : 'paused'}. {media.length} media,{' '}
              {texts(bodies).length} primary text{texts(bodies).length === 1 ? '' : 's'},{' '}
              {texts(titles).length} headline{texts(titles).length === 1 ? '' : 's'},{' '}
              {texts(descriptions).length} description{texts(descriptions).length === 1 ? '' : 's'}.
            </p>
          </div>
        </div>
        {status === 'PAUSED' && (
          <p className="text-xs text-text-muted">
            The ad is paused. Check it in Meta Ads Manager, then turn it on from the Ads column when you are ready to spend.
          </p>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      title="One ad, many versions"
      subtitle={`${campaign ? campaign.name + ' → ' : ''}${adset.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-text-muted tabular-nums">
            {assetTotal}/{FLEX_LIMITS.total} assets · 1 ad will be created
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || problems.length > 0}>
            {saving ? 'Creating…' : 'Create ad'}
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <div className="rounded-xl border border-border bg-bg/60 p-4">
        <p className="text-xs text-text-muted">
          Add several images or videos and several versions of the copy. Meta mixes them and shows more of the
          combinations that work. <span className="font-semibold text-text-primary">All versions report as ONE ad</span>,
          so the FB ROAS report and GHL credit the ad as a whole, not a single image or line of copy. To compare
          versions head to head, use New ads instead.
        </p>
      </div>

      {!dynamic && (
        <div className="rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-text-primary">This ad set cannot hold a many-versions ad</p>
          <p className="text-xs text-text-muted mt-1">
            Meta only allows it in an ad set created with Dynamic Creative on, and that cannot be switched on later.
            Create a new ad set with “One ad, many versions” ticked, then build the ad there. Each of those ad sets
            holds exactly one ad.
          </p>
        </div>
      )}
      {dynamic && hasAds && (
        <div className="rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-text-primary">This ad set already has its ad</p>
          <p className="text-xs text-text-muted mt-1">
            Meta allows one ad per Dynamic Creative ad set. Create another ad set for a second one.
          </p>
        </div>
      )}

      {needsSwitch && (
        <div className="rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-text-primary">This ad set still sends people to a website</p>
          <p className="text-xs text-text-muted mt-1">
            It optimizes for Instant form leads, but its destination is not set to the ad itself, so Meta
            rejects an ad that carries a form. Switching it sets the destination to the Instant Form.
          </p>
          <Button className="mt-3" onClick={switchToInstantForm} disabled={switching}>
            {switching ? 'Switching…' : 'Switch to Instant Form'}
          </Button>
        </div>
      )}

      <section className="rounded-xl border border-border bg-bg/60 p-4 space-y-4">
        <Field label="Ad name" required>
          <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 7 Day Trial, mixed" />
        </Field>
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
            ? 'Nobody lands here (the form opens in Facebook), but Meta rejects a lead ad whose link points at a Facebook Page.'
            : 'Where the ad sends people'}
        >
          <TextInput value={link} onChange={e => setLink(e.target.value)} placeholder="https://westcoaststrength.com/…" />
        </Field>
        <Field label="Start as">
          <Select
            value={status}
            onChange={e => setStatus(e.target.value)}
            options={[{ value: 'PAUSED', label: 'Paused (review first)' }, { value: 'ACTIVE', label: 'Active (start spending)' }]}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Images and videos{' '}
            <span className="font-normal normal-case tracking-normal tabular-nums">
              {imageCount}/{FLEX_LIMITS.media} images · {videoCount}/{FLEX_LIMITS.media} videos
            </span>
          </h4>
          <button
            type="button"
            onClick={showPreview}
            disabled={!media.length || !pageId || !link.trim()}
            className="text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
          >Preview first combination</button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleBulkFiles(e.dataTransfer.files) }}
          onClick={() => bulkInputRef.current && bulkInputRef.current.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragOver ? 'border-wcs-red bg-wcs-red/5' : 'border-border hover:border-wcs-red/40'}`}
        >
          <p className="text-sm font-semibold text-text-primary">Drop images or videos here</p>
          <p className="text-xs text-text-muted mt-0.5">They all go into this one ad. Mix images and videos freely.</p>
          <input
            ref={bulkInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={e => { handleBulkFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {media.map(m => (
            <div key={m.key} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
              <MediaPicker
                asset={m.asset}
                onChange={asset => setMedia(list => list.map(x => (x.key === m.key ? { ...x, asset } : x)))}
                compact
              />
              <button
                type="button"
                onClick={() => setMedia(list => list.filter(x => x.key !== m.key))}
                className="text-xs text-text-muted hover:text-red-600"
              >Remove</button>
            </div>
          ))}
          {/* An empty picker is the "add one" slot: whatever it gets is appended. */}
          <div className="rounded-xl border border-dashed border-border bg-surface p-3">
            <MediaPicker asset={null} onChange={asset => setMedia(list => [...list, mediaSlot(asset)])} compact />
          </div>
        </div>

        {preview && (
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
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 space-y-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Copy versions</h4>
        <VersionList
          label="Primary text"
          values={bodies}
          onChange={setBodies}
          max={FLEX_LIMITS.bodies}
          softLimit={COPY_LIMITS.message}
          hardLimit={FLEX_LIMITS.bodyChars}
          multiline
          placeholder="The main body copy people read first."
        />
        <VersionList
          label="Headline"
          values={titles}
          onChange={setTitles}
          max={FLEX_LIMITS.titles}
          softLimit={COPY_LIMITS.headline}
          hardLimit={FLEX_LIMITS.titleChars}
          placeholder="Bold text under the image"
        />
        <VersionList
          label="Description"
          values={descriptions}
          onChange={setDescriptions}
          max={FLEX_LIMITS.descriptions}
          softLimit={COPY_LIMITS.description}
          hardLimit={FLEX_LIMITS.descriptionChars}
          placeholder="Small text beside the button"
        />
        <p className="text-[11px] text-text-muted">
          Meta only uses the words written here. Its automatic text rewrites stay off.
        </p>
      </section>

      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">Before you can create this:</p>
          <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
            {problems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
            {problems.length > 6 && <li>…and {problems.length - 6} more</li>}
          </ul>
        </div>
      )}
    </Modal>
  )
}
