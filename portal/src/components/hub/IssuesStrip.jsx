// Top of the Hub: company issues that need attention (revenue gaps, sync or
// server problems). Empty until the Alerts project supplies issues; renders
// nothing when there are none.
const TONES = {
  red: 'border-red-500/40 bg-red-500/10 text-red-700',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-800',
}

export default function IssuesStrip({ issues = [] }) {
  if (!issues.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {issues.map(i => {
        const cls = `inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold ${TONES[i.tone] || TONES.amber}`
        return i.href
          ? <a key={i.id} href={i.href} className={`${cls} hover:opacity-80`}>⚠ {i.text}</a>
          : <span key={i.id} className={cls}>⚠ {i.text}</span>
      })}
    </div>
  )
}
