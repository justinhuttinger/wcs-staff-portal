// This one / all from here on. Only offered when the occurrence belongs to a
// series -- a one-off has nothing to apply forward to.
//
// An INFERRED series link is stated rather than hidden: it was matched by
// shape, not recorded, so the staff member should know what the change is about
// to touch before it rewrites months of calendar.
export default function EditScopeToggle({ scope, onChange, hasSeries, seriesSource }) {
  if (!hasSeries) return null
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex gap-1.5">
        {[
          { v: 'one', label: 'This class' },
          { v: 'forward', label: 'All from here on' },
        ].map(o => (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${
              scope === o.v
                ? 'bg-wcs-red text-white border-wcs-red font-medium'
                : 'border-border text-text-primary hover:bg-bg'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      {scope === 'forward' && seriesSource === 'inferred' && (
        <p className="text-xs text-amber-800">
          This class was matched to a repeating series by its day, time and instructor
          rather than a recorded link. Check the preview lists the classes you expect.
        </p>
      )}
    </div>
  )
}
