import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { KINDS, CHANGE_FLAGS, MERGE_FIELD_RE, stepSummary } from './kinds'

export const NODE_WIDTH = 260

export function KindIcon({ type, className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={KINDS[type]?.icon} />
    </svg>
  )
}

// Text with {first_name} / {{contact.first_name}} merge fields picked out.
export function MergeText({ text }) {
  if (!text) return null
  return String(text).split(MERGE_FIELD_RE).map((part, i) => (
    i % 2 === 1
      ? <span key={i} className="rounded px-0.5 bg-blue-500/10 text-blue-700 font-medium">{part}</span>
      : <span key={i}>{part}</span>
  ))
}

const hasTarget = (type) => type !== 'trigger' && type !== 'note'
const hasSource = (type) => type !== 'goal' && type !== 'note' && type !== 'condition'

function StepNode({ type, data, selected }) {
  const kind = KINDS[type] || KINDS.note
  const summary = stepSummary(type, data)
  const flag = CHANGE_FLAGS[data.change || '']
  const branches = type === 'condition' ? (data.branches || []) : []

  if (type === 'note') {
    return (
      <div className={`rounded-lg border p-3 shadow-sm bg-yellow-50 text-yellow-950 ${selected ? 'border-yellow-600 ring-2 ring-yellow-500/40' : 'border-yellow-300'}`} style={{ width: NODE_WIDTH }}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-700">
          <KindIcon type="note" className="w-3.5 h-3.5" /> Note
        </div>
        {data.title && <div className="text-sm font-semibold mt-1">{data.title}</div>}
        {data.body && <div className="text-xs mt-1 whitespace-pre-wrap line-clamp-6">{data.body}</div>}
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border bg-surface shadow-sm transition-shadow ${selected ? 'shadow-lg' : ''} ${data.change === 'remove' ? 'opacity-60' : ''}`}
      style={{ width: NODE_WIDTH, borderColor: selected ? kind.color : 'var(--color-border)', boxShadow: selected ? `0 0 0 2px ${kind.color}55` : undefined }}
    >
      {hasTarget(type) && <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-surface !border-2" style={{ borderColor: kind.color }} />}

      <div className="flex items-center gap-2 px-3 py-2 rounded-t-xl" style={{ background: kind.color + '14' }}>
        <span className="flex items-center justify-center w-6 h-6 rounded-md text-white shrink-0" style={{ background: kind.color }}>
          <KindIcon type={type} className="w-3.5 h-3.5" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: kind.color }}>{kind.label}</span>
        <span className="ml-auto flex items-center gap-1">
          {data.notes && <span title="Has internal notes" className="w-1.5 h-1.5 rounded-full bg-text-muted/60" />}
          {data.link && (
            <a href={data.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              className="nodrag px-1.5 py-0.5 rounded text-[10px] font-semibold border border-border bg-surface text-text-muted hover:text-text-primary" title={data.link}>
              Doc
            </a>
          )}
        </span>
      </div>

      <div className="px-3 py-2">
        <div className="text-sm font-semibold text-text-primary leading-snug break-words">{data.title || kind.label}</div>
        {summary && <div className="text-xs text-text-muted mt-1 line-clamp-3 whitespace-pre-wrap break-words"><MergeText text={summary} /></div>}
        {flag?.color && (
          <div className="mt-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: flag.color }}>{flag.label}</div>
        )}
      </div>

      {branches.length > 0 && (
        <div className="flex border-t border-border">
          {branches.map((b, i) => (
            <div key={b.id} className={`relative flex-1 text-center text-[10px] font-semibold text-text-muted py-1.5 ${i ? 'border-l border-border' : ''}`}>
              {b.label}
              <Handle id={b.id} type="source" position={Position.Bottom} className="!w-3 !h-3 !border-2 !bg-surface" style={{ borderColor: kind.color }} />
            </div>
          ))}
        </div>
      )}

      {hasSource(type) && <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-surface !border-2" style={{ borderColor: kind.color }} />}
    </div>
  )
}

export default memo(StepNode)
