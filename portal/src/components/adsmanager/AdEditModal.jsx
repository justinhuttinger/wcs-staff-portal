import { useState } from 'react'
import { updateAdsManagerAd, previewAdsManagerVariant } from '../../lib/api'
import { CALL_TO_ACTIONS, COPY_LIMITS } from './constants'
import { Modal, Field, TextInput, TextArea, Select, Button, CharCount, ErrorBanner } from './ui'
import { MediaPicker, useVideoProcessing, assetToVariantFields } from './MediaPicker'
import { isInstantFormAdset, useLeadForms, LeadFormPicker } from './LeadFormPicker'

// Pulls the flat editable fields back out of whichever creative shape Meta
// returned — link_data for image ads, video_data for video ads.
function readCreative(ad) {
  const spec = (ad.creative && ad.creative.object_story_spec) || {}
  const link = spec.link_data || spec.video_data || {}
  const isVideo = !!spec.video_data
  return {
    page_id: spec.page_id || '',
    instagram_user_id: spec.instagram_user_id || '',
    message: link.message || '',
    headline: link.name || link.title || '',
    description: link.description || link.link_description || '',
    link: link.link || (link.call_to_action && link.call_to_action.value && link.call_to_action.value.link) || '',
    call_to_action: (link.call_to_action && link.call_to_action.type) || 'LEARN_MORE',
    // Lead ads carry their Instant Form here. Meta creatives are immutable, so
    // an edit rebuilds the creative — losing this would quietly turn a working
    // lead ad into one that sends people to a Facebook Page.
    lead_gen_form_id: (link.call_to_action && link.call_to_action.value && link.call_to_action.value.lead_gen_form_id) || '',
    asset: isVideo
      ? { kind: 'video', video_id: link.video_id, thumbnail_url: link.image_url || (ad.creative && ad.creative.thumbnail_url), ready: true, name: 'Current video' }
      : link.image_hash
        ? { kind: 'image', hash: link.image_hash, url: (ad.creative && (ad.creative.image_url || ad.creative.thumbnail_url)) || null, name: 'Current image' }
        : null,
    // A creative built from an existing Page post has no editable link_data —
    // Meta only hands back the post id, so copy cannot be rewritten here.
    postBacked: !spec.link_data && !spec.video_data && !!(ad.creative && ad.creative.effective_object_story_id),
  }
}

export default function AdEditModal({ ad, adset, account, onClose, onSaved }) {
  const initial = readCreative(ad)
  const pages = account.pages || []
  // Trust the creative first: an ad that already carries a form is a lead ad
  // whatever the ad set says.
  const instantForm = !!initial.lead_gen_form_id || isInstantFormAdset(adset)

  const [name, setName] = useState(ad.name || '')
  const [status, setStatus] = useState(ad.status || 'PAUSED')
  const [editCreative, setEditCreative] = useState(false)
  const [pageId, setPageId] = useState(initial.page_id || (pages[0] && pages[0].id) || '')
  const [message, setMessage] = useState(initial.message)
  const [headline, setHeadline] = useState(initial.headline)
  const [description, setDescription] = useState(initial.description)
  const [link, setLink] = useState(initial.link)
  const [cta, setCta] = useState(initial.call_to_action)
  const [leadFormId, setLeadFormId] = useState(initial.lead_gen_form_id)
  const [asset, setAsset] = useState(initial.asset)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  useVideoProcessing(asset ? [asset] : [], ready => setAsset(ready))

  const page = pages.find(p => p.id === pageId) || null
  const leadForms = useLeadForms(pageId, instantForm && editCreative)

  function creativePayload() {
    return {
      page_id: pageId,
      instagram_user_id: page && page.instagram_id ? page.instagram_id : undefined,
      message,
      headline,
      description,
      link: instantForm ? undefined : link.trim(),
      lead_gen_form_id: instantForm ? leadFormId : undefined,
      call_to_action: cta,
      ...assetToVariantFields(asset),
    }
  }

  async function showPreview() {
    setPreview({ loading: true })
    try {
      const payload = creativePayload()
      const res = await previewAdsManagerVariant({ variant: payload, shared: payload })
      setPreview({ loading: false, html: res.html })
    } catch (err) {
      setPreview({ loading: false, error: err.message })
    }
  }

  async function submit() {
    if (!name.trim()) return setError('Give the ad a name')
    if (editCreative) {
      if (instantForm && !leadFormId) return setError('Choose the Instant form this ad opens')
      if (!instantForm && !link.trim()) return setError('A destination link is required')
      if (!asset) return setError('Pick an image or video')
      if (asset.kind === 'video' && !asset.ready) return setError('The video is still processing')
    }
    setSaving(true)
    setError('')
    try {
      await updateAdsManagerAd(ad.id, {
        name: name.trim(),
        status,
        creative: editCreative ? creativePayload() : undefined,
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Edit ad"
      subtitle={ad.name}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Ad name" required>
          <TextInput value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={e => setStatus(e.target.value)}
            options={[{ value: 'PAUSED', label: 'Paused' }, { value: 'ACTIVE', label: 'Active' }]}
          />
        </Field>
      </div>

      {initial.postBacked ? (
        <p className="text-xs text-text-muted rounded-lg border border-border bg-bg px-4 py-3">
          This ad runs an existing Page post, so its copy and media live on the post itself and cannot be
          rewritten here. Rename or pause it above, or create a new ad to change the creative.
        </p>
      ) : !editCreative ? (
        <div className="rounded-lg border border-border bg-bg px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-xs text-text-muted">
            Copy and media are locked. Meta cannot edit a creative in place — saving a change builds a new
            creative and points this ad at it, which restarts its learning phase.
          </p>
          <Button variant="secondary" onClick={() => setEditCreative(true)} className="!py-1.5 !px-3 !text-xs shrink-0">
            Edit creative
          </Button>
        </div>
      ) : (
        <section className="rounded-xl border border-border bg-bg/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Creative</h4>
            <button onClick={showPreview} className="text-xs text-text-muted hover:text-text-primary">Preview</button>
          </div>

          <div className="flex gap-4">
            <MediaPicker asset={asset} onChange={setAsset} compact />
            <div className="flex-1 min-w-0 space-y-3">
              <Field label="Facebook Page" required hint={page && page.instagram_id ? `Instagram: @${page.instagram_username}` : undefined}>
                <Select
                  value={pageId}
                  onChange={e => setPageId(e.target.value)}
                  options={[{ value: '', label: 'Select a Page…' }, ...pages.map(p => ({ value: p.id, label: p.name }))]}
                />
              </Field>
              <Field label="Primary text">
                <TextArea rows={3} value={message} onChange={e => setMessage(e.target.value)} />
              </Field>
              <div className="flex justify-end -mt-2"><CharCount value={message} limit={COPY_LIMITS.message} /></div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Field label="Headline">
                <TextInput value={headline} onChange={e => setHeadline(e.target.value)} />
              </Field>
              <div className="flex justify-end mt-1"><CharCount value={headline} limit={COPY_LIMITS.headline} /></div>
            </div>
            <div>
              <Field label="Description">
                <TextInput value={description} onChange={e => setDescription(e.target.value)} />
              </Field>
              <div className="flex justify-end mt-1"><CharCount value={description} limit={COPY_LIMITS.description} /></div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {instantForm ? (
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
            ) : (
              <Field label="Destination link" required>
                <TextInput value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" />
              </Field>
            )}
            <Field label="Call to action">
              <Select value={cta} onChange={e => setCta(e.target.value)} options={CALL_TO_ACTIONS} />
            </Field>
          </div>

          {preview && (
            <div className="rounded-lg border border-border bg-surface p-3">
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
      )}
    </Modal>
  )
}
