import { ACCENT_PRESETS, DEFAULT_ACCENT, normalizeAccent, accentInk } from '../../lib/theme'

// Hoisted to module scope so it is a stable component type across renders.
// Declaring this inside AccentPicker's body would make React remount every
// swatch (losing focus / the pressed state) on each re-render triggered by
// picking a color. This has already bitten this codebase twice, most
// recently on BackgroundPicker's Swatch.
function Swatch({ hex, label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={`h-9 w-9 shrink-0 rounded-full border-2 transition-transform ${
        selected ? 'border-text-primary scale-110' : 'border-border hover:scale-105'
      }`}
      style={{ backgroundColor: hex }}
    />
  )
}

/**
 * Pick the one color that drives both the Classic tile icon color and the
 * tile hover fill. A curated palette covers the common case; the custom
 * color input covers everything else, with accentInk (see lib/theme)
 * guaranteeing the hover text stays readable no matter how pale the pick.
 *
 * The mini preview below the swatches is what makes that guarantee visible:
 * accentInk silently flips from white to near-black text on light accents,
 * which is correct but surprising if the only place you'd see it is the
 * real tile board.
 */
export default function AccentPicker({ accent, onChange }) {
  const current = normalizeAccent(accent)
  const ink = accentInk(current)
  const matchesPreset = ACCENT_PRESETS.some(p => p.hex === current)

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Tile accent</p>
      <p className="text-xs text-text-muted -mt-2">
        Colors the tile icons and the hover fill on the Classic theme.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((p) => (
          <Swatch
            key={p.hex}
            hex={p.hex}
            label={p.label}
            selected={current === p.hex}
            onClick={() => onChange(p.hex)}
          />
        ))}

        <label className="flex items-center gap-2 ml-1">
          <span className="text-xs font-semibold text-text-muted">Custom</span>
          <input
            type="color"
            aria-label="Custom accent color"
            value={current}
            onChange={(e) => onChange(normalizeAccent(e.target.value))}
            className={`h-9 w-9 rounded-full border-2 cursor-pointer bg-transparent p-0 ${
              !matchesPreset ? 'border-text-primary' : 'border-border'
            }`}
          />
        </label>

        {current !== DEFAULT_ACCENT && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_ACCENT)}
            className="text-xs font-semibold text-text-muted hover:text-wcs-red ml-1"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-xl text-[11px] font-bold shrink-0"
          style={{ backgroundColor: current, color: ink }}
        >
          Tile
        </div>
        <p className="text-xs text-text-muted">
          Preview of a hovered tile: icon and hover fill in your accent, text kept readable automatically.
        </p>
      </div>
    </div>
  )
}
