import { useState, useEffect, useCallback } from 'react'
import { getTicketEmbeds, createTicketEmbed, updateTicketEmbed, deleteTicketEmbed } from '../../lib/api'

export default function TicketEmbedsAdmin() {
  const [embeds, setEmbeds] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | 'edit'
  const [editTarget, setEditTarget] = useState(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formOrder, setFormOrder] = useState(0)
  const [saving, setSaving] = useState(false)

  const fetchEmbeds = useCallback(async () => {
    try {
      const res = await getTicketEmbeds()
      setEmbeds(res.embeds || [])
    } catch { /* silent */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchEmbeds() }, [fetchEmbeds])

  function openAdd() {
    setFormName('')
    setFormDesc('')
    setFormUrl('')
    setFormOrder(0)
    setEditTarget(null)
    setModal('add')
  }

  function openEdit(embed) {
    setFormName(embed.name)
    setFormDesc(embed.description || '')
    setFormUrl(embed.iframe_url)
    setFormOrder(embed.sort_order || 0)
    setEditTarget(embed)
    setModal('edit')
  }

  function extractSrcFromHtml(input) {
    const match = input.match(/src=["']([^"']+)["']/)
    return match ? match[1] : input.trim()
  }

  async function handleSave() {
    if (!formName.trim() || !formUrl.trim()) return
    setSaving(true)
    try {
      const cleanUrl = extractSrcFromHtml(formUrl)
      const payload = { name: formName, description: formDesc, iframe_url: cleanUrl, sort_order: formOrder }
      if (modal === 'edit' && editTarget) {
        await updateTicketEmbed(editTarget.id, payload)
      } else {
        await createTicketEmbed(payload)
      }
      await fetchEmbeds()
      setModal(null)
    } catch { /* silent */ } finally { setSaving(false) }
  }

  async function handleDelete(embed) {
    if (!confirm(`Delete "${embed.name}"?`)) return
    try {
      await deleteTicketEmbed(embed.id)
      await fetchEmbeds()
    } catch { /* silent */ }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">Configure embedded ticket forms and support tools. Each embed appears as a tile in the Tickets view.</p>
        <button onClick={openAdd} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors shrink-0">
          + Add Embed
        </button>
      </div>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading...</p>
      ) : embeds.length === 0 ? (
        <div className="text-center py-8 bg-surface border border-border rounded-xl">
          <p className="text-sm text-text-muted">No ticket embeds configured yet</p>
          <p className="text-xs text-text-muted mt-1">Click "+ Add Embed" to add your first one</p>
        </div>
      ) : (
        <div className="space-y-2">
          {embeds.map(embed => (
            <div key={embed.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">{embed.name}</p>
                {embed.description && <p className="text-xs text-text-muted mt-0.5">{embed.description}</p>}
                <p className="text-[10px] text-text-muted mt-1 truncate">{embed.iframe_url}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(embed)} className="p-1.5 rounded-lg hover:bg-bg transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-text-muted">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                  </svg>
                </button>
                <button onClick={() => handleDelete(embed)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-red-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-primary">{modal === 'edit' ? 'Edit Embed' : 'Add Embed'}</h3>
              <button onClick={() => setModal(null)} className="text-text-muted hover:text-text-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Name</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Submit a Ticket" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Description (optional)</label>
                <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Brief label shown under the tile name" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Iframe URL</label>
                <input type="text" value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://forms.google.com/..." className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
                <p className="text-[10px] text-text-muted mt-1">Paste the embed URL (not the full iframe HTML — just the src URL)</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Sort Order</label>
                <input type="number" value={formOrder} onChange={e => setFormOrder(parseInt(e.target.value) || 0)} className="w-24 px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setModal(null)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving || !formName.trim() || !formUrl.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
