import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { publicHelpCenter } from '../lib/api'

// Login-free Help Center for the front desk iPads (help.html?token=...).
// Read-only: big touch targets, search across every article, and a reader
// with large type. The server only sends articles every staff member can see.

marked.setOptions({ breaks: true, gfm: true })

// A shared iPad left open shouldn't show yesterday's articles, or whatever the
// last person was reading, forever.
const REFRESH_MS = 10 * 60 * 1000
const IDLE_RESET_MS = 3 * 60 * 1000

// Links inside articles open in a new tab so the help page stays put.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function renderMarkdown(body) {
  return DOMPurify.sanitize(marked.parse(body || ''))
}

// Plain text for search + snippets.
function plain(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/[#>|]+|^\s*-\s/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function snippet(text, q) {
  if (!q) return text.slice(0, 140) + (text.length > 140 ? '…' : '')
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text.slice(0, 140) + (text.length > 140 ? '…' : '')
  const start = Math.max(0, i - 50)
  return (start > 0 ? '…' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? '…' : '')
}

const ARTICLE_CSS = `
.help-body { font-size: 18px; line-height: 1.7; color: var(--color-text-secondary, #374151); }
.help-body h1, .help-body h2, .help-body h3, .help-body h4 { color: var(--color-text-primary, #111827); font-weight: 800; line-height: 1.25; margin: 1.4em 0 0.5em; }
.help-body h1 { font-size: 1.6em; } .help-body h2 { font-size: 1.35em; } .help-body h3 { font-size: 1.15em; }
.help-body p { margin: 0.8em 0; }
.help-body ul, .help-body ol { margin: 0.8em 0; padding-left: 1.6em; }
.help-body ul { list-style: disc; } .help-body ol { list-style: decimal; }
.help-body li { margin: 0.35em 0; }
.help-body strong { color: var(--color-text-primary, #111827); }
.help-body a { color: var(--color-wcs-red, #e53e3e); text-decoration: underline; }
.help-body img { max-width: 100%; border-radius: 12px; border: 1px solid var(--color-border, #e5e7eb); margin: 1em 0; }
.help-body blockquote { border-left: 4px solid var(--color-wcs-red, #e53e3e); padding: 0.4em 1em; margin: 1em 0; background: rgba(229,62,62,0.05); border-radius: 0 8px 8px 0; }
.help-body code { background: rgba(0,0,0,0.06); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
.help-body table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 0.9em; }
.help-body th, .help-body td { border: 1px solid var(--color-border, #e5e7eb); padding: 8px 10px; text-align: left; }
.help-body hr { border: 0; border-top: 1px solid var(--color-border, #e5e7eb); margin: 1.6em 0; }
`

function Chevron({ dir = 'right', className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d={dir === 'right' ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
    </svg>
  )
}

function Message({ children, tone }) {
  return (
    <div className="max-w-xl mx-auto mt-24 px-6">
      <p className={`${tone === 'error' ? 'text-wcs-red' : 'text-text-muted'} text-lg bg-surface border border-border rounded-2xl px-6 py-10 text-center`}>{children}</p>
    </div>
  )
}

export default function HelpPublicApp({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [articleId, setArticleId] = useState(null)
  const scrollRef = useRef(null)

  const load = useCallback(async () => {
    if (!token) {
      setError('This link is missing its access code. Ask a manager for the Help Center link.')
      setLoading(false)
      return
    }
    try {
      setData(await publicHelpCenter.get(token))
      setError(null)
    } catch (e) {
      // Keep showing the last good copy if a refresh fails mid-shift.
      setError(prev => (data ? prev : e.message))
    } finally {
      setLoading(false)
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  // Back to the start after a few idle minutes, so the next person at the desk
  // isn't dropped into someone else's article or search.
  useEffect(() => {
    let timer
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { setQuery(''); setCategoryId(null); setArticleId(null) }, IDLE_RESET_MS)
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [])

  useEffect(() => { window.scrollTo({ top: 0 }) }, [articleId, categoryId])

  const categories = data?.categories || []
  const articles = useMemo(() => (data?.articles || []).map(a => ({ ...a, _text: plain(a.body) })), [data])
  const catById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])
  const countByCat = useMemo(() => {
    const m = {}
    for (const a of articles) if (a.category_id) m[a.category_id] = (m[a.category_id] || 0) + 1
    return m
  }, [articles])

  const q = query.trim()
  const results = useMemo(() => {
    if (!q) return []
    const terms = q.toLowerCase().split(/\s+/)
    return articles
      .map(a => {
        const title = a.title.toLowerCase()
        const text = a._text.toLowerCase()
        if (!terms.every(t => title.includes(t) || text.includes(t))) return null
        const score = terms.reduce((s, t) => s + (title.includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0), 0)
        return { a, score }
      })
      .filter(Boolean)
      .sort((x, y) => y.score - x.score)
      .map(x => x.a)
  }, [articles, q])

  const article = articleId ? articles.find(a => a.id === articleId) : null
  const category = categoryId ? catById[categoryId] : null
  const uncategorized = articles.filter(a => !a.category_id)

  function openArticle(id) { setArticleId(id) }
  function goHome() { setArticleId(null); setCategoryId(null); setQuery('') }
  function back() {
    if (articleId) setArticleId(null)
    else if (categoryId) setCategoryId(null)
    else setQuery('')
  }

  if (loading) return <Message>Loading Help Center…</Message>
  if (error && !data) return <Message tone="error">{error}</Message>

  const showBack = !!(article || category || q)

  return (
    <div className="min-h-screen bg-bg select-none" ref={scrollRef}>
      <style>{ARTICLE_CSS}</style>

      {/* Header */}
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          {showBack ? (
            <button onClick={back} aria-label="Back"
              className="shrink-0 w-12 h-12 rounded-full border border-border bg-bg text-text-primary flex items-center justify-center active:scale-95 transition-transform">
              <Chevron dir="left" className="w-6 h-6" />
            </button>
          ) : (
            <img src="/wcs-logo.png" alt="" className="shrink-0 w-12 h-12 object-contain" />
          )}
          <button onClick={goHome} className="shrink-0 text-left">
            <p className="text-xl font-extrabold text-text-primary leading-tight">Help Center</p>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Front Desk</p>
          </button>
          <div className="flex-1 relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={e => { setQuery(e.target.value); setArticleId(null) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder="Search how-tos…"
              className="w-full h-14 pr-12 rounded-2xl border border-border bg-bg text-lg text-text-primary focus:outline-none focus:border-wcs-red select-text"
              style={{ paddingLeft: '3.25rem' }}
              autoComplete="off" autoCorrect="off" spellCheck={false}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full text-text-muted flex items-center justify-center active:bg-border/50">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 pb-16">
        {article ? (
          <article className="bg-surface border border-border rounded-3xl px-8 py-8 md:px-12 md:py-10 select-text">
            {catById[article.category_id] && (
              <button onClick={() => { setArticleId(null); setQuery(''); setCategoryId(article.category_id) }}
                className="inline-block px-3 py-1 rounded-full bg-wcs-red/10 text-wcs-red text-sm font-semibold mb-3">
                {catById[article.category_id].name}
              </button>
            )}
            <h1 className="text-3xl font-extrabold text-text-primary leading-tight">{article.title}</h1>
            {article.updated_at && (
              <p className="text-sm text-text-muted mt-2">
                Updated {new Date(article.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
            <div className="help-body mt-6" dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body) }} />
          </article>
        ) : q ? (
          <section>
            <p className="text-sm font-semibold uppercase tracking-widest text-text-muted mb-3">
              {results.length} {results.length === 1 ? 'result' : 'results'} for “{q}”
            </p>
            {results.length === 0 ? (
              <Message>Nothing matches that. Try a different word, or ask a manager.</Message>
            ) : (
              <ArticleList items={results} catById={catById} onOpen={openArticle} query={q} />
            )}
          </section>
        ) : category ? (
          <section>
            <h2 className="text-3xl font-extrabold text-text-primary">{category.name}</h2>
            {category.description && <p className="text-lg text-text-muted mt-1">{category.description}</p>}
            <div className="mt-5">
              <ArticleList items={articles.filter(a => a.category_id === category.id)} onOpen={openArticle} />
            </div>
          </section>
        ) : (
          <section>
            {categories.length === 0 && uncategorized.length === 0 ? (
              <Message>No help articles yet.</Message>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categories.filter(c => countByCat[c.id]).map(c => (
                    <button key={c.id} onClick={() => setCategoryId(c.id)}
                      className="text-left bg-surface border border-border rounded-3xl p-6 min-h-[140px] flex flex-col justify-between active:scale-[0.98] active:border-wcs-red transition-all">
                      <div>
                        <p className="text-xl font-extrabold text-text-primary leading-snug">{c.name}</p>
                        {c.description && <p className="text-base text-text-muted mt-1.5 line-clamp-2">{c.description}</p>}
                      </div>
                      <div className="flex items-center justify-between mt-4">
                        <span className="text-sm font-semibold text-wcs-red">{countByCat[c.id]} {countByCat[c.id] === 1 ? 'article' : 'articles'}</span>
                        <span className="w-9 h-9 rounded-full bg-wcs-red/10 text-wcs-red flex items-center justify-center"><Chevron /></span>
                      </div>
                    </button>
                  ))}
                </div>
                {uncategorized.length > 0 && (
                  <div className="mt-8">
                    <p className="text-sm font-semibold uppercase tracking-widest text-text-muted mb-3">More articles</p>
                    <ArticleList items={uncategorized} onOpen={openArticle} />
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function ArticleList({ items, catById, onOpen, query }) {
  return (
    <div className="bg-surface border border-border rounded-3xl overflow-hidden divide-y divide-border">
      {items.map(a => (
        <button key={a.id} onClick={() => onOpen(a.id)}
          className="w-full text-left px-6 py-5 flex items-center gap-4 active:bg-wcs-red/5 transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-text-primary leading-snug">{a.title}</p>
            {catById && catById[a.category_id] && (
              <p className="text-xs font-semibold uppercase tracking-wider text-wcs-red mt-0.5">{catById[a.category_id].name}</p>
            )}
            <p className="text-base text-text-muted mt-1 line-clamp-2">{snippet(a._text, query)}</p>
          </div>
          <span className="shrink-0 text-text-muted"><Chevron /></span>
        </button>
      ))}
    </div>
  )
}
