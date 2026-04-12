/*
 * NOTE: All copy-to-clipboard buttons in this project MUST show a visual
 * confirmation animation (e.g. text changes to "Copied!" with a checkmark,
 * brief color flash, etc.) so the user knows the copy succeeded. Never use
 * a silent clipboard write without feedback.
 */

import { useState } from 'react'
import { api } from '../../lib/api'

function ActionCard({ title, desc, icon, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="group flex items-center gap-4 w-full px-4 py-4 bg-surface border border-border rounded-xl text-left hover:bg-bg/50 transition-colors disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red">
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="text-xs text-text-muted mt-0.5">{desc}</p>
      </div>
      {loading ? (
        <div className="w-5 h-5 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin shrink-0" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </svg>
      )}
    </button>
  )
}

function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <button
      onClick={handleCopy}
      className={`relative transition-all duration-200 ${className} ${
        copied ? 'bg-green-100 text-green-700 border-green-300 scale-95' : ''
      }`}
    >
      <span className={`inline-flex items-center gap-1 transition-opacity duration-150 ${copied ? 'opacity-0' : 'opacity-100'}`}>
        {label}
      </span>
      {copied && (
        <span className="absolute inset-0 flex items-center justify-center gap-1 text-green-700 animate-[fadeIn_0.15s_ease-out]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Copied!
        </span>
      )}
    </button>
  )
}

export default function PaychexAdmin() {
  const [result, setResult] = useState(null)
  const [resultTitle, setResultTitle] = useState('')
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)

  async function runAction(key, title, path) {
    setLoading(key)
    setError(null)
    setResult(null)
    setResultTitle(title)
    try {
      const data = await api(path)
      setResult(data)
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* Actions */}
      <div className="space-y-2">
        <ActionCard
          title="Get Companies"
          desc="Discover all Paychex company IDs linked to your API key"
          icon="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0-.008.003"
          onClick={() => runAction('companies', 'Companies', '/hr-documents/paychex-companies')}
          loading={loading === 'companies'}
        />
        <ActionCard
          title="Get Configured Locations"
          desc="See which locations have Paychex company IDs configured"
          icon="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
          onClick={() => runAction('locations', 'Configured Locations', '/hr-documents/paychex-locations')}
          loading={loading === 'locations'}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-bold text-text-primary">{resultTitle}</h3>
            <CopyButton
              text={JSON.stringify(result, null, 2)}
              label="Copy JSON"
              className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-bg border border-border text-text-muted hover:text-text-primary"
            />
          </div>

          {/* Companies result */}
          {result.companies && (
            <div className="divide-y divide-border">
              {result.companies.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-muted">No companies found — check your API key permissions</p>
              ) : (
                result.companies.map((company, i) => (
                  <div key={company.companyId || i} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary">
                        {company.legalName || company.displayName || `Company ${i + 1}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-text-muted">
                        <span>
                          <span className="font-medium text-text-primary">Company ID:</span>{' '}
                          <code className="bg-bg px-1.5 py-0.5 rounded text-[11px]">{company.companyId}</code>
                        </span>
                        {company.displayId && (
                          <span>
                            <span className="font-medium text-text-primary">Display ID:</span>{' '}
                            <code className="bg-bg px-1.5 py-0.5 rounded text-[11px]">{company.displayId}</code>
                          </span>
                        )}
                      </div>
                    </div>
                    <CopyButton
                      text={company.companyId}
                      label="Copy ID"
                      className="px-2 py-1 text-[10px] font-semibold rounded bg-wcs-red/10 text-wcs-red hover:bg-wcs-red/20"
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {/* Locations result */}
          {result.locations && (
            <div className="divide-y divide-border">
              {result.locations.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-muted">No locations configured</p>
              ) : (
                result.locations.map((loc, i) => (
                  <div key={loc.slug || i} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-green-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-text-primary">{loc.name}</p>
                      <p className="text-xs text-text-muted">{loc.slug}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Generic JSON fallback */}
          {!result.companies && !result.locations && (
            <pre className="px-4 py-3 text-xs text-text-secondary overflow-x-auto max-h-96 whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
