import { useState, useEffect, useCallback } from 'react'
import {
  getHelpCategories,
  createHelpCategory,
  updateHelpCategory,
  deleteHelpCategory,
  getHelpArticles,
  createHelpArticle,
  updateHelpArticle,
  deleteHelpArticle,
} from '../lib/api'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Category/Article Editor Modal
// ---------------------------------------------------------------------------
function EditorModal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Help Center View
// ---------------------------------------------------------------------------
export default function HelpCenterView({ user, onBack }) {
  const isAdmin = user?.staff?.role === 'admin'

  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Modal state
  const [modal, setModal] = useState(null) // null | 'add-category' | 'edit-category' | 'add-article' | 'edit-article'
  const [editTarget, setEditTarget] = useState(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchCategories = useCallback(async () => {
    try {
      const res = await getHelpCategories()
      setCategories(res.categories || [])
    } catch { /* silent */ }
  }, [])

  const fetchArticles = useCallback(async () => {
    try {
      const res = await getHelpArticles(selectedCategory)
      setArticles(res.articles || [])
    } catch { /* silent */ }
  }, [selectedCategory])

  useEffect(() => {
    setLoading(true)
    fetchCategories().finally(() => setLoading(false))
  }, [fetchCategories])

  useEffect(() => {
    fetchArticles()
  }, [fetchArticles])

  const filtered = articles.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)
  })

  // --- Category CRUD ---
  function openAddCategory() {
    setFormName('')
    setFormDesc('')
    setEditTarget(null)
    setModal('add-category')
  }

  function openEditCategory(cat) {
    setFormName(cat.name)
    setFormDesc(cat.description || '')
    setEditTarget(cat)
    setModal('edit-category')
  }

  async function handleSaveCategory() {
    if (!formName.trim()) return
    setSaving(true)
    try {
      if (modal === 'edit-category' && editTarget) {
        await updateHelpCategory(editTarget.id, { name: formName, description: formDesc })
      } else {
        await createHelpCategory({ name: formName, description: formDesc })
      }
      await fetchCategories()
      setModal(null)
    } catch { /* silent */ } finally { setSaving(false) }
  }

  async function handleDeleteCategory(cat) {
    if (!confirm(`Delete "${cat.name}" and all its articles?`)) return
    try {
      await deleteHelpCategory(cat.id)
      if (selectedCategory === cat.id) setSelectedCategory(null)
      await fetchCategories()
      await fetchArticles()
    } catch { /* silent */ }
  }

  // --- Article CRUD ---
  function openAddArticle() {
    setFormTitle('')
    setFormBody('')
    setFormCategoryId(selectedCategory || categories[0]?.id || '')
    setEditTarget(null)
    setModal('add-article')
  }

  function openEditArticle(article) {
    setFormTitle(article.title)
    setFormBody(article.body)
    setFormCategoryId(article.category_id)
    setEditTarget(article)
    setModal('edit-article')
  }

  async function handleSaveArticle() {
    if (!formTitle.trim() || !formBody.trim() || !formCategoryId) return
    setSaving(true)
    try {
      if (modal === 'edit-article' && editTarget) {
        await updateHelpArticle(editTarget.id, { title: formTitle, body: formBody, category_id: formCategoryId })
      } else {
        await createHelpArticle({ title: formTitle, body: formBody, category_id: formCategoryId })
      }
      await fetchArticles()
      setModal(null)
    } catch { /* silent */ } finally { setSaving(false) }
  }

  async function handleDeleteArticle(article) {
    if (!confirm(`Delete "${article.title}"?`)) return
    try {
      await deleteHelpArticle(article.id)
      if (selectedArticle?.id === article.id) setSelectedArticle(null)
      await fetchArticles()
    } catch { /* silent */ }
  }

  // --- Reading an article ---
  if (selectedArticle) {
    return (
      <div className="w-full max-w-3xl mx-auto px-8 pb-12">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setSelectedArticle(null)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h2 className="text-lg font-bold text-text-primary">Help Center</h2>
        </div>

        <article className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-text-primary">{selectedArticle.title}</h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                {selectedArticle.help_categories?.name && (
                  <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red font-medium">
                    {selectedArticle.help_categories.name}
                  </span>
                )}
                <span>{formatDate(selectedArticle.updated_at || selectedArticle.created_at)}</span>
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={() => openEditArticle(selectedArticle)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary transition-colors"
              >
                Edit
              </button>
            )}
          </div>
          <div className="prose prose-sm max-w-none text-text-secondary leading-relaxed whitespace-pre-wrap">
            {selectedArticle.body}
          </div>
        </article>

        {/* Edit modal */}
        {modal === 'edit-article' && (
          <EditorModal title="Edit Article" onClose={() => setModal(null)}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Category</label>
                <select value={formCategoryId} onChange={e => setFormCategoryId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red">
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Title</label>
                <input type="text" value={formTitle} onChange={e => setFormTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Body</label>
                <textarea value={formBody} onChange={e => setFormBody(e.target.value)} rows={12} className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red resize-y" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setModal(null)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors">Cancel</button>
                <button onClick={handleSaveArticle} disabled={saving || !formTitle.trim() || !formBody.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </EditorModal>
        )}
      </div>
    )
  }

  // --- Main list view ---
  return (
    <div className="w-full max-w-4xl mx-auto px-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Portal
          </button>
          <h2 className="text-lg font-bold text-text-primary">Help Center</h2>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={openAddCategory} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">
              + Category
            </button>
            <button onClick={openAddArticle} disabled={categories.length === 0} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40">
              + Article
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-4">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search help articles..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            !selectedCategory ? 'bg-wcs-red text-white' : 'bg-surface border border-border text-text-muted hover:text-text-primary'
          }`}
        >
          All
        </button>
        {categories.map(cat => (
          <div key={cat.id} className="relative group">
            <button
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                selectedCategory === cat.id ? 'bg-wcs-red text-white' : 'bg-surface border border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {cat.name}
            </button>
            {isAdmin && (
              <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
                <button onClick={() => openEditCategory(cat)} className="w-4 h-4 rounded-full bg-bg border border-border flex items-center justify-center hover:bg-surface">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5 text-text-muted">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                  </svg>
                </button>
                <button onClick={() => handleDeleteCategory(cat)} className="w-4 h-4 rounded-full bg-bg border border-border flex items-center justify-center hover:bg-red-50">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5 text-red-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Articles */}
      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-text-muted mx-auto mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <p className="text-sm font-medium text-text-primary">
            {categories.length === 0 ? 'No categories yet' : 'No articles found'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {isAdmin ? (categories.length === 0 ? 'Create a category to get started' : 'Add your first help article') : 'Check back later for help docs'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(article => (
            <div key={article.id} className="bg-surface border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setSelectedArticle(article)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-bg/50 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{article.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {article.help_categories?.name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red font-medium">
                        {article.help_categories.name}
                      </span>
                    )}
                    <span className="text-[11px] text-text-muted">{formatDate(article.updated_at || article.created_at)}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEditArticle(article)} className="p-1.5 rounded-lg hover:bg-bg transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-text-muted">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDeleteArticle(article)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-red-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                )}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {(modal === 'add-category' || modal === 'edit-category') && (
        <EditorModal title={modal === 'edit-category' ? 'Edit Category' : 'Add Category'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-1">Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Getting Started" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-1">Description (optional)</label>
              <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Brief description..." className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors">Cancel</button>
              <button onClick={handleSaveCategory} disabled={saving || !formName.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </EditorModal>
      )}

      {(modal === 'add-article' || modal === 'edit-article') && (
        <EditorModal title={modal === 'edit-article' ? 'Edit Article' : 'Add Article'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-1">Category</label>
              <select value={formCategoryId} onChange={e => setFormCategoryId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red">
                <option value="">Select a category...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-1">Title</label>
              <input type="text" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Article title..." className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-1">Body</label>
              <textarea value={formBody} onChange={e => setFormBody(e.target.value)} placeholder="Write the help article content..." rows={12} className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red resize-y" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors">Cancel</button>
              <button onClick={handleSaveArticle} disabled={saving || !formTitle.trim() || !formBody.trim() || !formCategoryId} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </EditorModal>
      )}
    </div>
  )
}
