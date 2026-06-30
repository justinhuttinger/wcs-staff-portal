import { useState, useEffect } from 'react'
import { vipReferrals } from '../../lib/api'

function embedSnippet(slug, audience) {
  return `<iframe id="wcs-vip-${slug}-${audience}" src="https://prospects-documents.onrender.com/widget/vip-referrals?location=${slug}&audience=${audience}" style="width:100%;border:0;min-height:600px" scrolling="no"></iframe>
<script>window.addEventListener('message',function(e){if(e.data&&e.data.type==='wcs-vip-height'){var f=document.getElementById('wcs-vip-${slug}-${audience}');if(f)f.style.height=e.data.height+'px';}});</script>`
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
        copied
          ? 'bg-green-100 text-green-800 border border-green-300'
          : 'bg-bg border border-border text-text-muted hover:text-text-primary hover:border-wcs-red'
      }`}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function ConfigRow({ cfg, onSaved }) {
  const [webhookUrl, setWebhookUrl] = useState(cfg.webhook_url || '')
  const [enabled, setEnabled]       = useState(!!cfg.enabled)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const dirty = webhookUrl !== (cfg.webhook_url || '') || enabled !== !!cfg.enabled

  async function handleSave() {
    setSaving(true); setSaveError(null); setSavedFlash(false)
    try {
      await vipReferrals.updateConfig(cfg.slug, { webhook_url: webhookUrl, enabled })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      if (onSaved) onSaved()
    } catch (e) {
      setSaveError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
      {/* Location header + enabled toggle */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-text-primary text-sm">{cfg.display_name || cfg.slug}</div>
          <div className="text-xs text-text-muted font-mono">{cfg.slug}</div>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
          <span>Enabled</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(v => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              enabled ? 'bg-wcs-red' : 'bg-border'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Webhook URL */}
      <div>
        <label className="text-xs font-medium text-text-muted block mb-1">Webhook URL</label>
        <input
          type="url"
          value={webhookUrl}
          onChange={e => setWebhookUrl(e.target.value)}
          placeholder="https://..."
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-xs font-mono focus:outline-none focus:border-wcs-red"
        />
      </div>

      {/* Save row */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-3 py-1.5 bg-wcs-red text-white rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-wcs-red/90 transition-colors"
        >
          {saving ? 'Saving...' : savedFlash ? 'Saved!' : 'Save'}
        </button>
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
      </div>

      {/* Embed snippets */}
      <div className="space-y-4 pt-2 border-t border-border">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Embed Snippets</p>

        {['staff', 'member'].map(audience => (
          <div key={audience} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-primary capitalize">{audience} widget</span>
              <CopyButton text={embedSnippet(cfg.slug, audience)} />
            </div>
            <pre className="bg-bg border border-border rounded-lg px-3 py-2 text-[10px] font-mono overflow-x-auto text-text-muted whitespace-pre-wrap break-all">
              {embedSnippet(cfg.slug, audience)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function VipReferralsConfig() {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await vipReferrals.listConfig()
      setConfigs(Array.isArray(r) ? r : (r.configs || []))
    } catch (e) {
      setError(e.message || 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-4">
      {loading && <p className="text-sm text-text-muted text-center py-8">Loading...</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}
      {configs.map(cfg => (
        <ConfigRow key={cfg.slug} cfg={cfg} onSaved={load} />
      ))}
      {!loading && !error && configs.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">No locations configured yet.</p>
      )}
    </div>
  )
}
